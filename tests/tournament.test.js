import test from 'node:test';
import assert from 'node:assert/strict';
import { initial, start, stat, resetGame, beginBreak } from '../src/engine.js';
import { initialTournament, saveTeam, savePlayer, deletePlayer, deleteTeam, saveMatch, deleteMatch, setMatchStatus, recordResult, standings, prepareMatchGame, validateTournament } from '../src/tournament.js';
import { exportGame, importGame, validateState } from '../src/game-transfer.js';
import { readTournament, writeTournament, exportTournament, importTournament } from '../src/tournament-storage.js';
function fixture() {
  const t = initialTournament();
  for (const name of ['Wolves', 'Panthers', 'Falcons']) { saveTeam(t, null, name); const team = t.teams.at(-1); for (let i = 0; i < 6; i++) savePlayer(t, team.id, null, name + ' ' + i, i); }
  saveMatch(t, null, { homeId: t.teams[0].id, awayId: t.teams[1].id, scheduledAt: '', court: 'Court 1' });
  return t;
}
test('directory CRUD validates unique teams, jerseys and stable identities', () => {
  const t = fixture(), team = t.teams[0], player = team.players[0];
  saveTeam(t, team.id, 'North Wolves'); savePlayer(t, team.id, player.id, 'Captain', '00');
  assert.equal(t.teams[0].id, team.id); assert.equal(t.teams[0].players[0].id, player.id);
  assert.throws(() => saveTeam(t, null, 'panthers'), /unique/);
  assert.throws(() => savePlayer(t, team.id, null, 'Other', '00'), /unique/);
  assert.throws(() => savePlayer(t, team.id, null, '', '12'));
  assert.throws(() => savePlayer(t, team.id, null, 'Other', '100'));
  deletePlayer(t, team.id, player.id); assert.equal(team.players.length, 5);
  assert.throws(() => deleteTeam(t, team.id), /matches/);
  deleteTeam(t, t.teams[2].id); assert.equal(t.teams.length, 2);
});
test('schedule CRUD validates teams and protects finalized matches', () => {
  const t = fixture(), match = t.matches[0];
  assert.throws(() => saveMatch(t, null, { homeId: match.homeId, awayId: match.homeId, scheduledAt: '', court: '' }), /different/);
  assert.throws(() => saveMatch(t, null, { homeId: 'missing', awayId: match.awayId, scheduledAt: '', court: '' }));
  saveMatch(t, match.id, { ...match, court: 'Final court', scheduledAt: '2026-12-01T15:00:00.000Z' }); assert.equal(match.court, 'Final court');
  recordResult(t, match.id, 60, 50, 1000);
  assert.throws(() => saveMatch(t, match.id, match), /scheduled/); assert.throws(() => deleteMatch(t, match.id), /Reopen/);
  setMatchStatus(t, match.id, 'scheduled'); deleteMatch(t, match.id); assert.equal(t.matches.length, 0);
});
test('only final results count and corrections recompute standings without duplicate games', () => {
  const t = fixture(), match = t.matches[0];
  assert.equal(standings(t).every(row => row.played === 0), true);
  recordResult(t, match.id, 70, 60, 1000);
  let winner = standings(t)[0]; assert.equal(winner.id, match.homeId); assert.equal(winner.wins, 1); assert.equal(winner.pf, 70); assert.equal(winner.diff, 10);
  recordResult(t, match.id, 60, 80, 2000);
  winner = standings(t)[0]; assert.equal(winner.id, match.awayId); assert.equal(winner.wins, 1); assert.equal(winner.played, 1); assert.equal(winner.pf, 80);
  setMatchStatus(t, match.id, 'cancelled'); assert.equal(standings(t).every(row => row.played === 0), true);
  assert.throws(() => recordResult(t, match.id, 1, 2, 3000), /cancelled/);
});
test('standings use percentage, difference, points and shared ranks, including uneven schedules', () => {
  const t = fixture(); recordResult(t, t.matches[0].id, 10, 5, 1);
  saveMatch(t, null, { homeId: t.teams[1].id, awayId: t.teams[2].id, scheduledAt: '', court: '' }); recordResult(t, t.matches[1].id, 10, 5, 2);
  assert.equal(standings(t)[0].id, t.teams[0].id); assert.equal(standings(t)[1].pct, .5);
  const blank = initialTournament(); saveTeam(blank, null, 'Z'); saveTeam(blank, null, 'A');
  assert.deepEqual(standings(blank).map(r => [r.name, r.rank]), [['A', 1], ['Z', 1]]);
});
test('invalid/tied scores never finalize or change standings', () => {
  const t = fixture(); for (const pair of [[5, 5], [-1, 0], [1.5, 2], [NaN, 2], [1000001, 1]]) assert.throws(() => recordResult(t, t.matches[0].id, ...pair, 1000));
  assert.equal(t.matches[0].status, 'scheduled'); assert.equal(standings(t)[0].played, 0);
});
test('loading snapshots directory, preserves settings and starts a fresh stopped game', () => {
  const t = fixture(), current = initial(); current.length = 720; current.teams.A.score = 88;
  const game = prepareMatchGame(t, t.matches[0].id, current);
  assert.equal(game.game, 720000); assert.equal(game.teams.A.score, 0); assert.equal(current.teams.A.score, 88);
  assert.equal(game.teams.A.name, 'Wolves'); assert.equal(game.teams.A.players.filter(p => p.on).length, 5);
  assert.equal(game.matchLink.matchId, t.matches[0].id); assert.equal(game.running, false);
  const p = t.teams[0].players[0]; savePlayer(t, t.teams[0].id, p.id, 'Renamed', '00');
  assert.notEqual(game.teams.A.players[0].name, 'Renamed');
});
test('loading blocked while running, on break, empty roster, or another unfinished game is linked', () => {
  const t = fixture(), id = t.matches[0].id, current = initial(); start(current);
  assert.throws(() => prepareMatchGame(t, id, current), /Stop/);
  current.running = current.shotRunning = false; beginBreak(current, 'Timeout', 30, 1);
  assert.throws(() => prepareMatchGame(t, id, current), /break/); current.break = null;
  const game = prepareMatchGame(t, id, current); assert.throws(() => prepareMatchGame(t, id, game), /already/);
  t.teams[0].players = []; assert.throws(() => prepareMatchGame(t, id, current), /player/);
});
test('fouled-out players cannot return by reloading a match or editing directory eligibility', () => {
  const t = fixture(), match = t.matches[0], game = prepareMatchGame(t, match.id, initial()), id = game.teams.A.players[0].id;
  for (let i = 0; i < 5; i++) stat(game, 'A', id, 'fls');
  assert.equal(game.teams.A.players[0].out, true); assert.throws(() => prepareMatchGame(t, match.id, game), /already/);
  const p = t.teams[0].players[0]; savePlayer(t, t.teams[0].id, p.id, 'New name', '00');
  assert.equal(game.teams.A.players[0].out, true); assert.equal(start(game), false);
});
test('linked results snapshot correct match and scores; later game changes do not rewrite history', () => {
  const t = fixture(), match = t.matches[0], game = prepareMatchGame(t, match.id, initial());
  game.teams.A.score = 50; game.teams.B.score = 40;
  assert.throws(() => recordResult(t, match.id, 55, 40, 1000, game), /changed/);
  start(game); assert.throws(() => recordResult(t, match.id, 50, 40, 1000, game), /Stop/); game.running = game.shotRunning = false;
  recordResult(t, match.id, 50, 40, 1000, game); game.teams.A.score = 60;
  assert.equal(match.result.game.teams.A.score, 50); assert.equal(match.result.homeScore, 50);
  assert.equal(prepareMatchGame(t, (() => { saveMatch(t, null, { homeId: match.homeId, awayId: t.teams[2].id, scheduledAt: '', court: '' }); return t.matches[1].id; })(), game).teams.A.score, 0);
});
test('reset and standalone game import detach tournament result association, legacy state still readable', () => {
  const t = fixture(), game = prepareMatchGame(t, t.matches[0].id, initial());
  assert.deepEqual(validateState(game).matchLink, game.matchLink);
  assert.equal(importGame(exportGame(game, 1000), 2000).matchLink, null);
  resetGame(game); assert.equal(game.matchLink, null);
  const old = initial(); delete old.matchLink; assert.equal(validateState(old).matchLink, null);
});
test('tournament backups preserve results and snapshots while invalid data is rejected', () => {
  const t = fixture(), match = t.matches[0], game = prepareMatchGame(t, match.id, initial()); game.teams.A.score = 10;
  recordResult(t, match.id, 10, 0, 1000, game);
  assert.deepEqual(importTournament(exportTournament(t)), t);
  for (const corrupt of [x => { x.matches[0].awayId = 'missing'; }, x => { x.matches[0].result.homeScore = 0; }, x => { x.teams[0].players[1].id = x.teams[0].players[0].id; }, x => { x.matches[0].result.game.matchLink.homeId = 'wrong'; }]) {
    const copy = structuredClone(t); corrupt(copy); assert.throws(() => validateTournament(copy));
  }
  assert.throws(() => importTournament('{')); assert.throws(() => importTournament(JSON.stringify({ format: 'courtside-tournament', version: 2, tournament: t })));
});
test('tournament storage failures preserve data and never overwrite standalone game storage', () => {
  const t = fixture(), writes = [];
  writeTournament({ setItem: (...args) => writes.push(args) }, t); assert.equal(writes[0][0], 'basketball_tournament_v1');
  assert.deepEqual(readTournament({ getItem: () => writes[0][1] }), t);
  assert.throws(() => readTournament({ getItem: () => '{broken', setItem: () => assert.fail('Must not overwrite') }), /cannot be read/);
  assert.throws(() => writeTournament({ setItem: () => { throw new Error('Quota'); } }, t), /Quota/);
});

test('conditional tournament writes preserve newer directory and schedule changes', () => {
  let raw = null; const storage = { getItem: () => raw, setItem: (key, value) => { raw = value; } };
  const t = fixture(); writeTournament(storage, t, null); const expected = raw;
  const stale = readTournament(storage), latest = readTournament(storage);
  saveTeam(latest, null, 'New team'); writeTournament(storage, latest, expected); const newer = raw;
  stale.name = 'Old edit'; assert.throws(() => writeTournament(storage, stale, expected), /tournament changed/); assert.equal(raw, newer);
});

test('equal win percentages break ties by difference then points, not name', () => {
  const t = initialTournament(); for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta']) saveTeam(t, null, name);
  const play = (a, b, home, away) => { saveMatch(t, null, { homeId: t.teams[a].id, awayId: t.teams[b].id, scheduledAt: '', court: '' }); recordResult(t, t.matches.at(-1).id, home, away, 1000); };
  play(0, 1, 50, 40); play(2, 3, 80, 70);
  assert.equal(standings(t)[0].name, 'Gamma'); // Equal win percentage and +10; more points scored.
  recordResult(t, t.matches[0].id, 60, 40, 2000);
  assert.equal(standings(t)[0].name, 'Alpha'); // +20 outweighs more points scored.
});
