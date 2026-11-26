import test from 'node:test';
import assert from 'node:assert/strict';
import { initial, addPlayer } from '../src/engine.js';
import { initialTournament, saveTeam, savePlayer, saveMatch, prepareMatchGame, recordResult, setMatchStatus } from '../src/tournament.js';
import { gamePlayers, tournamentPlayers, participated, doubleDigits, playerFacts, gameFacts, tournamentFacts, rankPlayers } from '../src/player-stats.js';

function fixture() {
  const t = initialTournament();
  for (const name of ['Wolves', 'Panthers']) {
    saveTeam(t, null, name); savePlayer(t, t.teams.at(-1).id, null, 'Alex', '1'); savePlayer(t, t.teams.at(-1).id, null, 'Bench player', '2');
  }
  const play = (reverse, scores) => {
    saveMatch(t, null, { homeId: t.teams[reverse ? 1 : 0].id, awayId: t.teams[reverse ? 0 : 1].id, scheduledAt: '', court: '' });
    const m = t.matches.at(-1), g = prepareMatchGame(t, m.id, initial());
    for (const team of Object.values(g.teams)) team.players[1].on = false;
    g.teams.A.score = scores[0]; g.teams.B.score = scores[1];
    return { m, g };
  };
  const first = play(false, [10, 2]);
  Object.assign(first.g.teams.A.players[0], { pts: 10, reb: 10, ast: 10, ms: 60000 });
  first.g.teams.B.players[0].pts = 2;
  recordResult(t, first.m.id, 10, 2, 1000, first.g);
  const second = play(true, [3, 5]); second.g.teams.A.players[0].pts = 3;
  Object.assign(second.g.teams.B.players[0], { pts: 5, ms: 120000 });
  recordResult(t, second.m.id, 3, 5, 2000, second.g);
  saveMatch(t, null, { homeId: t.teams[0].id, awayId: t.teams[1].id, scheduledAt: '', court: '' });
  recordResult(t, t.matches.at(-1).id, 100, 50, 3000);
  return t;
}

test('tournament player identity survives home/away changes without merging same-named opponents', () => {
  const t = fixture(), result = tournamentPlayers(t);
  assert.deepEqual([result.finals, result.recorded, result.manual], [3, 2, 1]);
  const home = result.rows.find(p => p.teamId === t.teams[0].id && p.name === 'Alex');
  const away = result.rows.find(p => p.teamId === t.teams[1].id && p.name === 'Alex');
  assert.equal(home.pts, 15); assert.equal(home.gp, 2); assert.equal(home.ms, 180000);
  assert.equal(away.pts, 5); assert.notEqual(home.key, away.key);
  assert.equal(home.logs.length, 2); assert.equal(home.logs[0].pts, 10);
});

test('appearance denominator excludes unused bench entries and unknown manual-result appearances', () => {
  const t = fixture(), rows = tournamentPlayers(t).rows;
  const bench = rows.filter(p => p.name === 'Bench player');
  assert.equal(bench.length, 2); assert.equal(bench.every(p => p.gp === 0), true);
  assert.equal(rows.find(p => p.name === 'Alex').gp, 2);
  assert.equal(participated({ ...initial().teams.A.players[0], fls: 1 }), true);
  assert.equal(participated(initial().teams.A.players[0]), false);
});

test('current directory renames preserve totals and deleted players keep archived history', () => {
  const t = fixture(), team = t.teams[0]; savePlayer(t, team.id, team.players[0].id, 'Captain Alex', '00');
  assert.equal(tournamentPlayers(t).rows.find(p => p.name === 'Captain Alex').pts, 15);
  team.players = [];
  assert.equal(tournamentPlayers(t).rows.find(p => p.teamId === team.id && p.pts === 15).logs.length, 2);
});

test('ad-hoc player IDs remain match-specific instead of merging jerseys or names', () => {
  const t = fixture();
  for (const m of t.matches.filter(m => m.result.game)) {
    const g = m.result.game; addPlayer(g, 'A', 'Same guest', '99');
    g.teams.A.players.at(-1).pts = 4;
  }
  const rows = tournamentPlayers(t).rows.filter(p => p.name === 'Same guest');
  assert.equal(rows.length, 2); assert.equal(rows.every(p => p.gp === 1 && p.pts === 4 && p.identityScope === 'match'), true);
});

test('double/triple-double facts use individual game stats, exclude fouls, and do not combine games', () => {
  const t = fixture(), p = tournamentPlayers(t).rows.find(p => p.pts === 15);
  assert.equal(playerFacts(p).find(f => f.kind === 'double').value, 1);
  assert.equal(playerFacts(p).find(f => f.kind === 'triple').value, 1);
  assert.equal(playerFacts(p).find(f => f.kind === 'best').value, 10);
  const fake = { ...p, pts: 12, reb: 12, ast: 12, logs: Array.from({ length: 2 }, () => ({ appeared: true, pts: 6, reb: 6, ast: 6, stl: 0, blk: 0 })) };
  assert.equal(playerFacts(fake).some(f => ['double', 'triple'].includes(f.kind)), false);
  assert.deepEqual(doubleDigits({ pts: 10, reb: 10, ast: 0, stl: 0, blk: 0, fls: 10 }), ['pts', 'reb']);
});

test('game facts acknowledge tied scoring leaders and official/player score discrepancies', () => {
  const game = initial(); game.teams.A.score = 40; game.teams.B.score = 35;
  game.teams.A.players[0].pts = 20; game.teams.B.players[0].pts = 20;
  const facts = gameFacts(game);
  assert.equal(facts.find(f => f.kind === 'margin').value, 5);
  assert.equal(facts.find(f => f.kind === 'scorer').title, 'Joint scoring leaders');
  assert.match(facts.find(f => f.kind === 'scorer').text, /Player A1.*Player B1/);
  assert.equal(facts.filter(f => f.kind === 'reconciliation').length, 2);
  assert.equal(gameFacts(initial()).some(f => f.kind === 'scorer'), false);
  assert.equal(gameFacts(game, true)[0].title, 'Final winning margin');
});

test('tournament game facts include manual scores while player facts use saved box scores only', () => {
  const t = fixture(), facts = tournamentFacts(t);
  assert.equal(facts.find(f => f.kind === 'margin').value, 50);
  assert.equal(facts.find(f => f.kind === 'combined').value, 150);
  assert.equal(facts.find(f => f.kind === 'close').value, 1);
  assert.equal(facts.find(f => f.kind === 'coverage').value, '2 / 3');
  assert.equal(facts.find(f => f.kind === 'scorer').value, '15 PTS');
});

test('corrections and reopened matches recompute stats without duplicating the live final', () => {
  const t = fixture();
  t.matches[0].result.game.teams.A.players[0].pts = 8;
  assert.equal(tournamentPlayers(t).rows.find(p => p.teamId === t.teams[0].id && p.name === 'Alex').pts, 13);
  setMatchStatus(t, t.matches[0].id, 'scheduled');
  assert.equal(tournamentPlayers(t).rows.find(p => p.teamId === t.teams[0].id && p.name === 'Alex').gp, 1);
  assert.equal(tournamentPlayers(t).recorded, 1);
});

test('average ranking is based on recorded appearances and never ranks missing averages above real stats', () => {
  const rows = [{ key: 'a', name: 'A', pts: 30, gp: 3 }, { key: 'b', name: 'B', pts: 20, gp: 1 }, { key: 'c', name: 'C', pts: 0, gp: 0 }];
  assert.deepEqual(rankPlayers(rows, 'pts', true).map(p => p.key), ['b', 'a', 'c']);
  assert.deepEqual(rankPlayers(rows, 'pts').map(p => p.key), ['a', 'b', 'c']);
});

test('stats and facts do not mutate input, include zero entries, and handle empty tournaments', () => {
  const t = fixture(), before = structuredClone(t), game = initial(), beforeGame = structuredClone(game);
  tournamentPlayers(t); tournamentFacts(t); gameFacts(game); gamePlayers(game);
  assert.deepEqual(t, before); assert.deepEqual(game, beforeGame);
  assert.equal(gamePlayers(game).length, 14);
  assert.deepEqual(tournamentPlayers(initialTournament()).rows, []);
  assert.equal(tournamentFacts(initialTournament())[0].kind, 'empty');
});
