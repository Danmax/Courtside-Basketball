import test from 'node:test';
import assert from 'node:assert/strict';
import { initial, start, stop, startShotClock, recordShot, voidShot, stat, beginBreak, removeFromCourt, deletePlayer, resetGame } from '../src/engine.js';
import { shootingTotals, percentage } from '../src/shooting.js';
import { validateState, exportGame, importGame } from '../src/game-transfer.js';
import { writeGame, readGame } from '../src/storage.js';
import { gamePlayers, tournamentPlayers } from '../src/player-stats.js';
import { initialTournament, saveTeam, savePlayer, saveMatch, prepareMatchGame, recordResult } from '../src/tournament.js';
import { exportTournament, importTournament } from '../src/tournament-storage.js';

const shot = (s, value = 2, made = true, id = 'A0', x = value === 3 ? .1 : .5, y = value === 3 ? .65 : .3) => recordShot(s, 'A', id, value, made, value === 1 ? null : x, value === 1 ? null : y, 1000);

test('made field goal records coordinates and credits exactly its point value, changing possession and resetting shot clock', () => {
  const s = initial(); start(s); s.shot = 3500;
  assert.equal(shot(s, 3), true);
  assert.equal(s.teams.A.score, 3); assert.equal(s.teams.A.players[0].pts, 3);
  assert.equal(s.possession, 'B'); assert.equal(s.shot, 24000); assert.equal(s.shotRunning, true);
  assert.deepEqual(s.shots[0], { id: 'shot-1', team: 'A', playerId: 'A0', playerName: 'Player A1', playerNumber: '1', value: 3, made: true, x: .1, y: .65, quarter: 1, gameMs: 600000, timestamp: 1000, voided: false });
  assert.equal(s.running, true); assert.equal(s.teams.A.players[0].reb, 0);
});

test('missed attempts preserve score, possession and clock values/running state', () => {
  const s = initial(); start(s); s.shot = 3500;
  assert.equal(shot(s, 2, false), true);
  assert.equal(s.teams.A.score, 0); assert.equal(s.teams.A.players[0].pts, 0);
  assert.equal(s.possession, 'A'); assert.equal(s.shot, 3500); assert.equal(s.running, true); assert.equal(s.shotRunning, true);
  assert.equal(shootingTotals(s.shots).fga, 1); assert.equal(shootingTotals(s.shots).fgm, 0);
});

test('field-goal entry while paused never restarts clocks, including at a period horn', () => {
  const s = initial(); s.game = 0;
  assert.equal(shot(s), true); assert.equal(s.running, false); assert.equal(s.shotRunning, false);
  assert.equal(s.teams.A.score, 2); assert.equal(s.game, 0);
});

test('free throws are separate from field goals and leave clocks and possession under official control', () => {
  const s = initial(); s.possession = 'B'; s.shot = 12000;
  assert.equal(shot(s, 1, true), true); assert.equal(shot(s, 1, false), true);
  assert.deepEqual(shootingTotals(s.shots), { fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 1, fta: 2, points: 1 });
  assert.equal(s.possession, 'B'); assert.equal(s.shot, 12000); assert.equal(s.running, false); assert.equal(s.shotRunning, false);
  start(s); assert.equal(shot(s, 1), false); stop(s); startShotClock(s); assert.equal(shot(s, 1), false);
});

test('bench, fouled-out and missing players cannot record attempts', () => {
  const s = initial(); assert.equal(shot(s, 2, true, 'A5'), false); assert.equal(shot(s, 2, true, 'missing'), false);
  for (let i = 0; i < 5; i++) stat(s, 'A', 'A0', 'fls');
  assert.equal(shot(s, 2, true), false); assert.equal(shot(s, 2, false), false);
  assert.equal(s.shots.length, 0); assert.equal(s.teams.A.score, 0); assert.equal(s.teams.A.players[0].out, true);
});

test('breaks, shot-clock violations, invalid coordinates/types/values and full logs reject atomically', () => {
  const s = initial(); beginBreak(s, 'Timeout', 30, 0); assert.equal(shot(s), false); s.break = null;
  s.violation = true; assert.equal(shot(s), false); s.violation = false;
  for (const [x, y] of [[-1, .5], [1.1, .5], [.5, NaN], [null, .5], ['.5', .5], [.5, Infinity]]) assert.equal(shot(s, 2, true, 'A0', x, y), false);
  assert.equal(recordShot(s, 'A', 'A0', 1, true, .5, .3, 1000), false);
  assert.equal(recordShot(s, 'A', 'A0', 4, true, .5, .3, 1000), false);
  assert.equal(recordShot(s, 'A', 'A0', 2, 'made', .5, .3, 1000), false);
  assert.equal(recordShot(s, 'A', 'A0', 2, true, .5, .3, -1), false);
  assert.equal(recordShot(s, 'C', 'A0', 2, true, .5, .3, 1000), false);
  assert.equal(s.shots.length, 0); assert.equal(s.teams.A.score, 0);
  s.shots = Array(5000).fill({}); assert.equal(shot(s), false);
});

test('field-goal values follow location even when a caller requests a different point value', () => {
  const s = initial(); assert.equal(shot(s, 3, false, 'A0', 0, 0), true); assert.equal(shot(s, 2, false, 'A0', 1, 1), true);
  assert.equal(s.shots[0].value, 3); assert.equal(s.shots[1].value, 3);
  assert.equal(shot(s, 3, false, 'A0', .5, .3), true); assert.equal(s.shots[2].value, 2);
});

test('shooting percentages use recorded attempts, include threes in FG, exclude free throws and voided entries', () => {
  const s = initial(); stat(s, 'A', 'A0', 'pts', 2);
  assert.equal(percentage(0, 0), '—'); assert.equal(shootingTotals(s.shots).fga, 0);
  shot(s, 2, true); shot(s, 3, false); shot(s, 3, true); shot(s, 1, true);
  assert.deepEqual(shootingTotals(s.shots, 'A', 'A0'), { fgm: 2, fga: 3, tpm: 1, tpa: 2, ftm: 1, fta: 1, points: 6 });
  assert.equal(percentage(2, 3), '66.7%'); assert.equal(shootingTotals(s.shots, 'B').fga, 0);
  assert.equal(voidShot(s, s.shots[0].id), true); assert.equal(shootingTotals(s.shots).fgm, 1);
});

test('voiding subtracts only made points, never clears foul-outs or changes possession/clocks', () => {
  const s = initial(); shot(s, 3); s.possession = 'A'; s.shot = 9000;
  for (let i = 0; i < 5; i++) stat(s, 'A', 'A0', 'fls');
  assert.equal(voidShot(s, 'shot-1'), true); assert.equal(voidShot(s, 'shot-1'), false);
  assert.equal(s.teams.A.score, 0); assert.equal(s.teams.A.players[0].pts, 0);
  assert.equal(s.teams.A.players[0].out, true); assert.equal(s.teams.A.players[0].fls, 5);
  assert.equal(s.shot, 9000); assert.equal(s.possession, 'A'); assert.equal(start(s), false);
  assert.equal(s.shots[0].voided, true);
});

test('voids require stopped clocks and cannot make manually corrected scores negative', () => {
  const s = initial(); shot(s); start(s); assert.equal(voidShot(s, 'shot-1'), false);
  stop(s); startShotClock(s); assert.equal(voidShot(s, 'shot-1'), false); stop(s);
  s.teams.A.score = 1; assert.equal(voidShot(s, 'shot-1'), false); assert.equal(s.shots[0].voided, false);
  assert.equal(s.teams.A.players[0].pts, 2);
});

test('missed-only players count as recorded appearances and remain in the roster even after void', () => {
  const s = initial(); shot(s, 2, false);
  assert.equal(gamePlayers(s).find(p => p.id === 'A0').gp, 1);
  removeFromCourt(s, 'A', 'A0'); assert.equal(deletePlayer(s, 'A', 'A0'), false);
  voidShot(s, 'shot-1'); assert.equal(deletePlayer(s, 'A', 'A0'), false);
  assert.equal(gamePlayers(s).find(p => p.id === 'A0').gp, 0);
});

test('backups preserve shots, old games default to no history, invalid shot records are rejected', () => {
  const s = initial(); shot(s); shot(s, 1, false);
  assert.deepEqual(importGame(exportGame(s, 1000), 2000).shots, s.shots);
  const old = initial(); delete old.shots; delete old.gameId;
  assert.deepEqual(validateState(old).shots, []); assert.equal(validateState(old).gameId, null);
  for (const change of [r => { r.x = -1; }, r => { r.playerId = 'missing'; }, r => { r.value = 4; }, r => { r.made = 'yes'; }, r => { r.quarter = 99; }, r => { r.timestamp = -1; }]) {
    const copy = structuredClone(s); change(copy.shots[0]); assert.throws(() => validateState(copy));
  }
  const copy = structuredClone(s); copy.shots.push({ ...copy.shots[0] }); assert.throws(() => validateState(copy));
});

test('game identity changes only for new/reset/imported games and is assigned only after a successful save', () => {
  let raw = null; const storage = { getItem: () => raw, setItem: (key, value) => { raw = value; } }, s = initial();
  writeGame(storage, s); const first = s.gameId; assert.ok(first);
  writeGame(storage, s); assert.equal(readGame(storage).gameId, first);
  shot(s); resetGame(s); assert.deepEqual(s.shots, []); writeGame(storage, s); assert.notEqual(s.gameId, first);
  assert.equal(importGame(exportGame(s, 1000)).gameId, null);
  const failed = initial(); assert.throws(() => writeGame({ setItem: () => { throw new Error('Quota'); } }, failed)); assert.equal(failed.gameId, null);
});

test('archived tournaments preserve shot charts and aggregate shooting by makes/attempts, not averaged percentages', () => {
  const t = initialTournament();
  for (const name of ['Home', 'Away']) { saveTeam(t, null, name); savePlayer(t, t.teams.at(-1).id, null, 'Captain', 1); }
  for (const attempts of [1, 3]) {
    saveMatch(t, null, { homeId: t.teams[0].id, awayId: t.teams[1].id, scheduledAt: '', court: '' });
    const g = prepareMatchGame(t, t.matches.at(-1).id, initial()), id = g.teams.A.players[0].id;
    for (let n = 0; n < attempts; n++) shot(g, 2, n === 0, id);
    recordResult(t, t.matches.at(-1).id, g.teams.A.score, 0, 1000, g);
  }
  const row = tournamentPlayers(t).rows.find(p => p.teamId === t.teams[0].id);
  assert.equal(row.shooting.fgm, 2); assert.equal(row.shooting.fga, 4); assert.equal(percentage(row.shooting.fgm, row.shooting.fga), '50.0%');
  assert.equal(row.gp, 2); assert.deepEqual(importTournament(exportTournament(t)).matches[1].result.game.shots, t.matches[1].result.game.shots);
});
