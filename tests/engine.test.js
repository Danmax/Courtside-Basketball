import test from 'node:test';import assert from 'node:assert/strict';import {initial,tick,start,format,possession,beginBreak,stat,substitute} from '../src/engine.js';
test('clock and player time',()=>{let s=initial();s.stamp=1000;start(s);tick(s,2250);assert.equal(s.game,598750);assert.equal(s.teams.A.players[0].ms,1250);assert.equal(format(142000),'02:22');assert.equal(format(12345,true),'00:12.34')});
test('possession resets shot',()=>{let s=initial();s.shot=2000;possession(s,'B');assert.equal(s.shot,24000)});test('timeout deducts and expires without resuming',()=>{let s=initial();beginBreak(s,'Timeout',30,1000,'A');assert.equal(s.teams.A.timeouts,2);tick(s,31000);assert.equal(s.break,null);assert.equal(s.running,false)});test('foul out and replacement',()=>{let s=initial();for(let i=0;i<6;i++)stat(s,'A','A0','fls');assert.equal(s.teams.A.players[0].fls,5);assert.equal(substitute(s,'A','A0','A5'),true);assert.equal(s.teams.A.players[0].on,false)});

// Roster and official clock workflows.
const {
  parseClock, setClock, startShotClock, stopShotClock, resetShotClock, stop,
  addPlayer, updatePlayer, deletePlayer, removeFromCourt, putOnCourt, resetGame,
  renameTeam,
} = await import('../src/engine.js');

function foulOut(s, k = 'A', id = 'A0') {
  for (let i = 0; i < s.personalLimit; i++) stat(s, k, id, 'fls');
}

test('official time entry parses exact milliseconds and rejects malformed times', () => {
  for (const [value, expected] of [['2:15.5', 135500], ['00:12.34', 12340], ['0:00.001', 1], ['10:00', 600000], [' 0:24.000 ', 24000], ['0:00', 0]]) {
    assert.equal(parseClock(value), expected);
  }
  for (const value of ['', '24', '-1:00', '1:60', '1:1', 'NaN:00', '1:00.1234', '1:00x', '1000:00']) assert.equal(parseClock(value), null);
});

test('clock correction is exact, validates values and preserves manual restart', () => {
  const s = initial();
  assert.equal(setClock(s, 'game', 12345), true);
  s.violation = true;
  assert.equal(setClock(s, 'shot', 11501), true);
  assert.equal(s.game, 12345);
  assert.equal(s.shot, 11501);
  assert.equal(s.violation, false);
  tick(s, 100000);
  assert.equal(s.game, 12345);
  assert.equal(s.shot, 11501);
  for (const value of [-1, NaN, Infinity, '1000', 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(setClock(s, 'game', value), false);
  assert.equal(setClock(s, 'stamp', 1000), false);
});

test('corrections are rejected while either clock runs or during a break', () => {
  const s = initial();
  start(s);
  assert.equal(setClock(s, 'game', 1000), false);
  stop(s); startShotClock(s);
  assert.equal(setClock(s, 'shot', 1000), false);
  stop(s); beginBreak(s, 'Timeout', 30, 0);
  assert.equal(setClock(s, 'game', 1000), false);
  assert.equal(resetShotClock(s), false);
});

test('shot clock can run with game paused without adding playing time', () => {
  const s = initial(); s.stamp = 1000;
  assert.equal(startShotClock(s), true);
  tick(s, 2500);
  assert.equal(s.game, 600000); assert.equal(s.shot, 22500);
  assert.equal(s.teams.A.players[0].ms, 0);
  stopShotClock(s); tick(s, 3000);
  assert.equal(s.shot, 22500);
});

test('stopping shot clock does not stop game clock or player minutes', () => {
  const s = initial(); s.stamp = 1000; start(s); stopShotClock(s);
  tick(s, 3000);
  assert.equal(s.game, 598000); assert.equal(s.shot, 24000);
  assert.equal(s.teams.A.players[0].ms, 2000);
  possession(s, 'B');
  assert.equal(s.shotRunning, true); assert.equal(s.shot, 24000);
});

test('independent shot expiration stops clocks and needs official restart', () => {
  const s = initial(); s.stamp = 1000; startShotClock(s); tick(s, 50000);
  assert.equal(s.shot, 0); assert.equal(s.game, 600000);
  assert.equal(s.violation, true); assert.equal(s.shotRunning, false);
  assert.equal(startShotClock(s), false); assert.equal(s.violation, true);
  assert.equal(resetShotClock(s, 14000), true);
  assert.equal(s.shot, 14000); assert.equal(s.shotRunning, false);
  tick(s, 51000); assert.equal(s.shot, 14000);
  assert.equal(startShotClock(s), true);
});

test('shot reset preserves independent running state and rejects invalid reset', () => {
  const s = initial(); startShotClock(s); tick(s, 1000);
  assert.equal(resetShotClock(s), true); assert.equal(s.shotRunning, true);
  for (const value of [0, -1, NaN, Infinity, 2.5]) assert.equal(resetShotClock(s, value), false);
  stop(s); s.game = 0; assert.equal(startShotClock(s), false);
});

test('break expiration never resumes either clock, including late ticks', () => {
  const s = initial(); start(s); beginBreak(s, 'Halftime', 60, 1000);
  assert.equal(start(s), false); assert.equal(startShotClock(s), false);
  tick(s, 121000);
  assert.equal(s.break, null); assert.equal(s.running, false); assert.equal(s.shotRunning, false);
  assert.equal(s.game, 600000); assert.equal(s.shot, 24000);
  assert.equal(start(s), true); tick(s, 122000); assert.equal(s.game, 599000);
});

test('timestamps that move backwards do not count elapsed time twice', () => {
  const s = initial(); s.stamp = 1000; start(s);
  tick(s, 2000); tick(s, 1500); tick(s, 2500);
  assert.equal(s.game, 598500); assert.equal(s.teams.A.players[0].ms, 1500);
});

test('period expiration limits game and shot elapsed time', () => {
  const s = initial(); setClock(s, 'game', 1500); s.stamp = 1000; start(s); tick(s, 100000);
  assert.equal(s.game, 0); assert.equal(s.shot, 22500);
  assert.equal(s.teams.A.players[0].ms, 1500); assert.equal(s.running, false);
});

test('roster add and edit preserve stable identity and game statistics', () => {
  const s = initial();
  assert.equal(addPlayer(s, 'A', '  New player  ', '00'), true);
  const p = s.teams.A.players.at(-1);
  assert.equal(p.name, 'New player'); assert.equal(p.number, '00'); assert.equal(p.on, false);
  assert.equal(new Set(s.teams.A.players.map(p => p.id)).size, 8);
  stat(s, 'A', 'A0', 'pts', 2);
  assert.equal(updatePlayer(s, 'A', 'A0', 'Updated name', '12'), true);
  assert.equal(s.teams.A.players[0].pts, 2); assert.equal(s.teams.A.score, 2);
  assert.equal(s.teams.A.players[0].id, 'A0'); assert.equal(s.teams.A.players[0].number, '12');
});

test('roster rejects duplicate jerseys, blank names, and malformed numbers', () => {
  const s = initial();
  for (const [name, number] of [['', '10'], ['  ', '10'], ['x'.repeat(81), '10'], ['Name', '1'], ['Name', '-1'], ['Name', '100'], ['Name', '1.5']]) assert.equal(addPlayer(s, 'A', name, number), false);
  assert.equal(updatePlayer(s, 'A', 'A0', 'Name', 2), false);
  assert.equal(updatePlayer(s, 'A', 'missing', 'Name', 12), false);
  assert.equal(addPlayer(s, 'missing', 'Name', 12), false);
  assert.equal(s.teams.A.players.length, 7);
});

test('roster additions obey the storage limit and allocate IDs across both teams', () => {
  const s = initial(); s.teams.B.players[0].id = 'A7';
  assert.equal(addPlayer(s, 'A', 'New player', '00'), true);
  assert.equal(s.teams.A.players.at(-1).id, 'A8');
  s.teams.A.players = Array.from({ length: 100 }, (_, i) => ({ ...s.teams.A.players[0], id: 'full-' + i, number: String(i), on: false }));
  const before = structuredClone(s);
  assert.equal(addPlayer(s, 'A', 'Extra', '00'), false);
  assert.deepEqual(s, before);
});

test('stat overflow is rejected before changing scores, fouls, possession or the journal', () => {
  for (const key of ['reb', 'pts', 'fls']) {
    const s = initial(); s.teams.A.players[0][key] = Number.MAX_SAFE_INTEGER;
    const before = structuredClone(s);
    assert.equal(stat(s, 'A', 'A0', key), false); assert.deepEqual(s, before);
  }
  for (const [key, teamKey] of [['pts', 'score'], ['fls', 'fouls']]) {
    const s = initial(); s.teams.A[teamKey] = Number.MAX_SAFE_INTEGER;
    const before = structuredClone(s);
    assert.equal(stat(s, 'A', 'A0', key), false); assert.deepEqual(s, before);
  }
});

test('team names are trimmed and invalid names leave the game unchanged', () => {
  const s = initial(); assert.equal(renameTeam(s, 'A', '  Falcons  '), true); assert.equal(s.teams.A.name, 'Falcons');
  const before = structuredClone(s);
  for (const name of ['', '   ', 'x'.repeat(81), null, 7]) assert.equal(renameTeam(s, 'A', name), false);
  assert.equal(renameTeam(s, 'missing', 'Team'), false); assert.deepEqual(s, before);
});

test('invalid breaks never stop live clocks or deduct a timeout', () => {
  const s = initial(); start(s); const before = structuredClone(s);
  for (const [seconds, now] of [[-1, 1000], [0, 1000], ['30', 1000], [NaN, 1000], [Infinity, 1000], [30, -1], [30, NaN], [30, Number.MAX_SAFE_INTEGER]]) {
    assert.equal(beginBreak(s, 'Timeout', seconds, now, 'A'), false); assert.deepEqual(s, before);
  }
  assert.equal(beginBreak(s, '', 30, 1000, 'A'), false); assert.deepEqual(s, before);
});

test('a break defensively stops both clocks and never resumes after expiration', () => {
  const s = initial(); start(s); s.stamp = 1000; s.break = { label: 'Timeout', end: 2000 };
  tick(s, 1500); assert.equal(s.running, false); assert.equal(s.shotRunning, false);
  tick(s, 5000); assert.equal(s.break, null); assert.equal(s.game, 600000); assert.equal(s.shot, 24000);
});

test('roster and lineup operations are rejected while either clock runs', () => {
  for (const begin of [start, startShotClock]) {
    const s = initial(); begin(s);
    assert.equal(addPlayer(s, 'A', 'Name', 12), false);
    assert.equal(updatePlayer(s, 'A', 'A0', 'Name', 12), false);
    assert.equal(deletePlayer(s, 'A', 'A5'), false);
    assert.equal(removeFromCourt(s, 'A', 'A0'), false);
    assert.equal(putOnCourt(s, 'A', 'A5'), false);
    assert.equal(substitute(s, 'A', 'A0', 'A5'), false);
  }
});

test('deleting is limited to bench players with no recorded game activity', () => {
  const s = initial();
  assert.equal(deletePlayer(s, 'A', 'A0'), false);
  assert.equal(deletePlayer(s, 'A', 'missing'), false);
  assert.equal(deletePlayer(s, 'A', 'A5'), true);
  assert.equal(s.teams.A.players.length, 6);
  stat(s, 'A', 'A0', 'reb'); removeFromCourt(s, 'A', 'A0');
  assert.equal(deletePlayer(s, 'A', 'A0'), false);
  s.teams.A.players[1].ms = 1; removeFromCourt(s, 'A', 'A1');
  assert.equal(deletePlayer(s, 'A', 'A1'), false);
  assert.equal(addPlayer(s, 'A', 'Replacement', 20), true);
  assert.equal(new Set(s.teams.A.players.map(p => p.id)).size, s.teams.A.players.length);
});

test('lineups cannot exceed five and substitution is atomic', () => {
  const s = initial();
  assert.equal(putOnCourt(s, 'A', 'A5'), false);
  assert.equal(substitute(s, 'A', 'A0', 'A1'), false);
  assert.equal(substitute(s, 'A', 'A0', 'missing'), false);
  assert.equal(s.teams.A.players[0].on, true);
  assert.equal(substitute(s, 'A', 'A0', 'A5'), true);
  assert.equal(s.teams.A.players.filter(p => p.on).length, 5);
  assert.equal(removeFromCourt(s, 'A', 'A1'), true);
  assert.equal(putOnCourt(s, 'A', 'A6'), true);
  assert.equal(putOnCourt(s, 'A', 'A6'), false);
});

test('no-bench foul-out requires removal and manual restart with fewer players', () => {
  const s = initial(); s.teams.A.players = s.teams.A.players.slice(0, 5);
  start(s); foulOut(s);
  assert.equal(s.running, false); assert.equal(s.shotRunning, false);
  assert.equal(start(s), false); assert.equal(startShotClock(s), false);
  assert.equal(removeFromCourt(s, 'A', 'A0'), true);
  assert.equal(s.running, false); assert.equal(s.shotRunning, false);
  assert.equal(s.teams.A.players.filter(p => p.on).length, 4);
  assert.equal(start(s), true);
});

test('fouled-out players cannot return through any roster or lineup action', () => {
  const s = initial(); foulOut(s);
  assert.equal(updatePlayer(s, 'A', 'A0', 'Renamed player', 12), true);
  assert.equal(s.teams.A.players[0].out, true);
  assert.equal(substitute(s, 'A', 'A0', 'A5'), true);
  assert.equal(putOnCourt(s, 'A', 'A0'), false);
  assert.equal(substitute(s, 'A', 'A5', 'A0'), false);
  assert.equal(deletePlayer(s, 'A', 'A0'), false);
  assert.equal(stat(s, 'A', 'A0', 'pts', 3), false);
  assert.equal(s.teams.A.players[0].fls, 5);
});

test('reset clears game activity and preserves roster identity, names and settings', () => {
  const s = initial(); s.teams.A.name = 'Falcons'; s.length = 720; s.shotDefault = 30; s.personalLimit = 6;
  addPlayer(s, 'B', 'New player', '00'); updatePlayer(s, 'A', 'A0', 'Captain', 12);
  stat(s, 'A', 'A0', 'pts', 3); foulOut(s); substitute(s, 'A', 'A0', 'A5');
  beginBreak(s, 'Timeout', 60, 1000, 'A');
  const roster = Object.fromEntries(['A', 'B'].map(k => [k, s.teams[k].players.map(p => [p.id, p.name, p.number])]));
  resetGame(s);
  assert.equal(s.teams.A.name, 'Falcons'); assert.equal(s.game, 720000); assert.equal(s.shot, 30000);
  assert.equal(s.personalLimit, 6); assert.equal(s.quarter, 1); assert.equal(s.break, null);
  assert.equal(s.running, false); assert.equal(s.shotRunning, false); assert.equal(s.violation, false);
  assert.equal(s.possession, 'A'); assert.equal(s.stamp, 0); assert.deepEqual(s.log, []);
  for (const k of ['A', 'B']) {
    const t = s.teams[k]; assert.equal(t.score, 0); assert.equal(t.fouls, 0); assert.equal(t.timeouts, 3);
    assert.deepEqual(t.players.map(p => [p.id, p.name, p.number]), roster[k]);
    assert.equal(t.players.filter(p => p.on).length, 5);
    for (const p of t.players) {
      assert.equal(p.out, false);
      for (const key of ['pts', 'reb', 'ast', 'stl', 'blk', 'fls', 'ms']) assert.equal(p[key], 0);
    }
  }
  assert.equal(s.teams.A.players.find(p => p.id === 'A5').on, true);
});

test('reset supports small and empty rosters without inventing players', () => {
  const s = initial(); s.teams.A.players = []; s.teams.B.players = s.teams.B.players.slice(0, 3);
  resetGame(s);
  assert.equal(s.teams.A.players.length, 0); assert.equal(s.teams.B.players.length, 3);
  assert.equal(s.teams.B.players.filter(p => p.on).length, 3);
});


test('start game clears a shot violation, reloads the configured shot clock and resumes both clocks', () => {
  const s = initial(); s.shotDefault = 30; s.stamp = 1000; start(s); tick(s, 26000);
  assert.equal(s.violation, true); assert.equal(s.shot, 0);
  const remaining = s.game, minutes = s.teams.A.players[0].ms, owner = s.possession;
  assert.equal(start(s), true);
  assert.equal(s.violation, false); assert.equal(s.shot, 30000);
  assert.equal(s.running, true); assert.equal(s.shotRunning, true);
  assert.equal(s.game, remaining); assert.equal(s.teams.A.players[0].ms, minutes); assert.equal(s.possession, owner);
  assert.match(s.log[0], /violation cleared/);
  tick(s, 27000); assert.equal(s.game, remaining - 1000); assert.equal(s.shot, 29000);
  assert.equal(s.teams.A.players[0].ms, minutes + 1000);
});

test('start rejected by break, period end or unresolved foul-out leaves violation and clocks unchanged', () => {
  for (const block of [s => { s.break = { label: 'Timeout', end: 30000 }; }, s => { s.game = 0; }, s => { foulOut(s); }]) {
    const s = initial(); block(s); s.violation = true; s.shot = 0;
    const before = structuredClone(s);
    assert.equal(start(s), false); assert.deepEqual(s, before);
  }
});

test('normal game start and repeated starts preserve the chosen shot time without a violation', () => {
  const s = initial(); s.shot = 14000;
  assert.equal(start(s), true); assert.equal(s.shot, 14000);
  s.stamp = 1000; tick(s, 2000);
  const entries = s.log.length;
  assert.equal(start(s), true); assert.equal(s.shot, 13000); assert.equal(s.log.length, entries);
});
