import test from 'node:test';
import assert from 'node:assert/strict';
import { initial, applyGameRules, openingGame, nextPeriod, start, stop, tick, possession, stat, addTeamScore, recordShot, beginBreak, resetGame, resetShotClock, setClock, startShotClock, removeFromCourt, putOnCourt } from '../src/engine.js';
import { DEFAULT_GAME_RULES, OPTIONAL_RULE_KEYS, gameRules, validateGameRules, periodLabel, gameRulesSummary } from '../src/game-rules.js';
import { validateState, exportGame, importGame } from '../src/game-transfer.js';
import { initialTournament, saveTeam, savePlayer, saveMatch, prepareMatchGame, recordResult } from '../src/tournament.js';
import { exportTournament, importTournament } from '../src/tournament-storage.js';

const custom = () => ({ ...DEFAULT_GAME_RULES, periods: 2, length: 1200, shotDefault: 30, shotReset: 20, personalLimit: 6, teamLimit: 7, teamFoulReset: 'half', timeoutsPerTeam: 5, timeoutShort: 45, timeoutLong: 90, halftime: 8, stopOnScore: true });

test('game rule validation is typed, bounded and does not copy unrelated state', () => {
  assert.deepEqual(validateGameRules(initial()), DEFAULT_GAME_RULES);
  const invalid = { periods: [0, -1, 1.5, '4', Infinity], length: [0, 86401, 1.5], shotDefault: [0, 86401], shotReset: [0, 25], personalLimit: [0, NaN], teamLimit: [0, 2.5], timeoutsPerTeam: [-1, 100, .5], timeoutShort: [0, 61, 3601], timeoutLong: [-1, 3601], halftime: [-1, 1441, .5], teamFoulReset: ['quarter', null], shotEnabled: ['true', 0], stopOnScore: ['false', null] };
  for (const [key, values] of Object.entries(invalid)) for (const value of values) assert.throws(() => validateGameRules({ ...DEFAULT_GAME_RULES, [key]: value }), undefined, `${key} = ${value}`);
  assert.throws(() => validateGameRules({ ...DEFAULT_GAME_RULES, periods: 3, teamFoulReset: 'half' }), /even/);
  assert.deepEqual(validateGameRules({ ...DEFAULT_GAME_RULES, teams: 'ignored', game: 1 }), DEFAULT_GAME_RULES);
  assert.equal(validateGameRules({ ...DEFAULT_GAME_RULES, halftime: 0, timeoutsPerTeam: 0 }).halftime, 0);
});

test('opening rule setup sets clocks and timeout balances without changing rosters or game identity', () => {
  const s = initial(); s.gameId = 'opening'; s.teams.A.name = 'Wolves'; s.log = ['Roster prepared'];
  const teams = structuredClone(s.teams); assert.equal(openingGame(s), true);
  assert.equal(applyGameRules(s, custom()), true);
  assert.deepEqual(gameRules(s), custom()); assert.equal(s.game, 1200000); assert.equal(s.shot, 30000);
  assert.equal(s.teams.A.timeouts, 5); assert.equal(s.teams.B.timeouts, 5); assert.equal(s.gameId, 'opening');
  assert.deepEqual(s.teams.A.players, teams.A.players); assert.equal(s.teams.A.name, 'Wolves');
  assert.equal(s.running, false); assert.equal(s.shotRunning, false); assert.ok(s.log.includes('Roster prepared'));
  assert.equal(periodLabel(s), 'H1'); assert.match(gameRulesSummary(s), /2 × 20 min/);
});

test('midgame rules preserve remaining clocks, timeouts, scores, stats and shot history', () => {
  const s = initial(); s.gameId = 'in-progress'; s.stamp = 1000; start(s); tick(s, 3000); stop(s);
  stat(s, 'A', 'A0', 'pts', 3); recordShot(s, 'B', 'B0', 2, false, .5, .3, 3000);
  s.teams.A.timeouts = 2; s.teams.A.fouls = 3; const before = structuredClone(s);
  applyGameRules(s, custom());
  assert.equal(s.game, before.game); assert.equal(s.shot, before.shot); assert.equal(s.teams.A.timeouts, 2); assert.equal(s.teams.B.timeouts, 3);
  assert.equal(s.teams.A.score, 3); assert.equal(s.teams.A.fouls, 3); assert.deepEqual(s.teams.A.players, before.teams.A.players); assert.deepEqual(s.shots, before.shots);
  assert.equal(s.gameId, 'in-progress'); assert.equal(s.running, false); assert.equal(s.shotRunning, false);
});

test('rule changes reject running clocks, breaks and period counts excluding recorded history atomically', () => {
  for (const prepare of [s => start(s), s => startShotClock(s), s => beginBreak(s, 'Timeout', 30, 1000), s => { s.quarter = 3; }, s => { recordShot(s, 'A', 'A0', 2, false, .5, .3, 1000); s.shots[0].quarter = 3; s.shots[0].voided = true; }]) {
    const s = initial(); prepare(s); const before = structuredClone(s);
    assert.throws(() => applyGameRules(s, custom())); assert.deepEqual(s, before);
  }
  const s = initial(), before = structuredClone(s); assert.throws(() => applyGameRules(s, { ...custom(), shotReset: 31 })); assert.deepEqual(s, before);
});

test('lowering a foul limit disqualifies current/bench players and raising it never restores eligibility', () => {
  const s = initial(); for (let i = 0; i < 5; i++) stat(s, 'A', 'A0', 'fls'); removeFromCourt(s, 'A', 'A0');
  for (let i = 0; i < 3; i++) stat(s, 'B', 'B0', 'fls'); removeFromCourt(s, 'B', 'B0');
  for (let i = 0; i < 3; i++) stat(s, 'B', 'B1', 'fls');
  applyGameRules(s, { ...gameRules(s), personalLimit: 3 });
  assert.equal(s.teams.B.players[0].out, true); assert.equal(s.teams.B.players[1].out, true); assert.equal(start(s), false);
  applyGameRules(s, { ...gameRules(s), personalLimit: 7 });
  assert.equal(s.teams.A.players[0].out, true); assert.equal(s.teams.B.players[0].out, true);
  assert.equal(putOnCourt(s, 'A', 'A0'), false); assert.equal(putOnCourt(s, 'B', 'B0'), false); assert.equal(start(s), false);
  assert.doesNotThrow(() => validateState(s));
});

test('disabled shot clock never counts down or creates violations but possession still resets it', () => {
  const s = initial(); applyGameRules(s, { ...custom(), shotEnabled: false }); s.stamp = 1000;
  assert.equal(start(s), true); tick(s, 41000); assert.equal(s.game, 1160000); assert.equal(s.teams.A.players[0].ms, 40000);
  assert.equal(s.shot, 30000); assert.equal(s.shotRunning, false); assert.equal(s.violation, false);
  s.shot = 5000; possession(s, 'B'); assert.equal(s.shot, 30000); assert.equal(s.shotRunning, false);
  stop(s); assert.equal(startShotClock(s), false); assert.equal(resetShotClock(s), false); assert.equal(setClock(s, 'shot', 1000), false);
  assert.match(gameRulesSummary(s), /No shot clock/);
  const restored = importGame(exportGame(s, 42000), 50000); assert.equal(restored.shotEnabled, false); assert.equal(restored.running, false);
});

test('disabling a violated shot clock clears the violation without starting play', () => {
  const s = initial(); s.violation = true; s.shot = 0;
  applyGameRules(s, { ...gameRules(s), shotEnabled: false });
  assert.equal(s.violation, false); assert.equal(s.running, false); assert.equal(s.shotRunning, false);
});

test('stop-after-score applies to player points, unassigned points and court makes, with manual restart', () => {
  for (const score of [s => stat(s, 'A', 'A0', 'pts', 3), s => addTeamScore(s, 'A', 2), s => recordShot(s, 'A', 'A0', 2, true, .5, .3, 2000)]) {
    const s = initial(); applyGameRules(s, { ...gameRules(s), stopOnScore: true }); s.stamp = 1000; start(s); tick(s, 2000);
    assert.equal(score(s), true); assert.equal(s.running, false); assert.equal(s.shotRunning, false); assert.equal(s.possession, 'B'); assert.equal(s.shot, 24000);
    tick(s, 3000); assert.equal(s.game, 599000); assert.equal(start(s), true);
  }
  const s = initial(); applyGameRules(s, { ...gameRules(s), stopOnScore: true }); start(s);
  recordShot(s, 'A', 'A0', 2, false, .5, .3, 1000); assert.equal(s.running, true); assert.equal(s.shotRunning, true);
  addTeamScore(s, 'A', -1); assert.equal(s.running, true);
});

test('period foul resets follow period, half or game policy without resetting personal fouls/timeouts', () => {
  for (const [policy, expected] of [['period', [0, 0, 0]], ['half', [2, 0, 2]], ['game', [2, 2, 2]]]) {
    const s = initial(); applyGameRules(s, { ...gameRules(s), length: 480, teamFoulReset: policy }); s.teams.A.players[0].fls = 2; s.teams.A.timeouts = 1;
    for (const fouls of expected) { s.teams.A.fouls = 2; start(s); assert.equal(nextPeriod(s), true); assert.equal(s.teams.A.fouls, fouls); assert.equal(s.game, 480000); assert.equal(s.running, false); assert.equal(s.shotRunning, false); assert.equal(s.teams.A.players[0].fls, 2); assert.equal(s.teams.A.timeouts, 1); }
    const before = structuredClone(s); assert.equal(nextPeriod(s), false); assert.deepEqual(s, before);
  }
  const s = initial(); applyGameRules(s, custom()); s.teams.A.fouls = 4; nextPeriod(s); assert.equal(s.teams.A.fouls, 0); assert.equal(periodLabel(s), 'H2');
});

test('configured foul thresholds and timeout allowances/durations drive existing rule controls', () => {
  const s = initial(); applyGameRules(s, { ...gameRules(s), personalLimit: 3, teamLimit: 2, timeoutsPerTeam: 1, timeoutShort: 45, timeoutLong: 90 });
  stat(s, 'A', 'A0', 'fls'); stat(s, 'A', 'A1', 'fls'); assert.equal(s.log.filter(text => text.includes('team foul limit')).length, 1);
  stat(s, 'A', 'A0', 'fls'); stat(s, 'A', 'A0', 'fls'); assert.equal(s.teams.A.players[0].out, true);
  assert.equal(beginBreak(s, 'Timeout', s.timeoutShort, 1000, 'A'), true); assert.equal(s.break.end, 46000); assert.equal(s.teams.A.timeouts, 0);
  tick(s, 46000); const before = structuredClone(s); assert.equal(beginBreak(s, 'Timeout', s.timeoutLong, 47000, 'A'), false); assert.deepEqual(s, before);
});

test('reset and tournament match loading preserve all configured rules and use the new allowances', () => {
  const s = initial(); applyGameRules(s, custom()); stat(s, 'A', 'A0', 'pts', 3); resetGame(s);
  assert.deepEqual(gameRules(s), custom()); assert.equal(s.game, 1200000); assert.equal(s.teams.A.timeouts, 5); assert.equal(s.running, false);
  const t = initialTournament(); for (const name of ['Home', 'Away']) { saveTeam(t, null, name); savePlayer(t, t.teams.at(-1).id, null, 'Captain', 1); }
  saveMatch(t, null, { homeId: t.teams[0].id, awayId: t.teams[1].id, scheduledAt: '', court: '' });
  const g = prepareMatchGame(t, t.matches[0].id, s); assert.deepEqual(gameRules(g), custom()); assert.equal(g.teams.B.timeouts, 5);
  g.teams.A.score = 10; recordResult(t, t.matches[0].id, 10, 0, 1000, g);
  assert.deepEqual(gameRules(importTournament(exportTournament(t)).matches[0].result.game), custom());
});

test('older game/backup rules receive compatible defaults and invalid optional rules are rejected', () => {
  const old = initial(); for (const key of OPTIONAL_RULE_KEYS) delete old[key];
  assert.deepEqual(gameRules(validateState(old)), DEFAULT_GAME_RULES);
  old.shotDefault = 10; old.shot = 10000; assert.equal(validateState(old).shotReset, 10);
  for (const change of [s => { s.shotEnabled = 'no'; }, s => { s.shotReset = 25; }, s => { s.timeoutsPerTeam = -1; }, s => { s.teamFoulReset = 'quarter'; }, s => { s.stopOnScore = 1; }, s => { s.shotEnabled = false; s.shotRunning = true; }]) {
    const s = initial(); change(s); assert.throws(() => validateState(s));
  }
  const s = initial(); applyGameRules(s, custom()); assert.deepEqual(gameRules(importGame(exportGame(s, 1000), 2000)), custom());
});
