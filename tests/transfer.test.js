import test from 'node:test';
import assert from 'node:assert/strict';
import { initial, start, beginBreak, stat, KEY } from '../src/engine.js';
import { exportGame, importGame, validateState, MAX_BACKUP_BYTES } from '../src/game-transfer.js';
import { readGame, writeGame } from '../src/storage.js';

const file = state => JSON.stringify({ format: 'basketball-scoreboard', version: 1, exportedAt: 1000, state });

test('backup round trip preserves rosters, score, settings, stats and log without changing live state', () => {
  const s = initial(); stat(s, 'A', 'A0', 'pts', 3); s.length = 720;
  const before = structuredClone(s);
  const imported = importGame(exportGame(s, 1000), 5000);
  assert.deepEqual(s, before);
  assert.deepEqual(imported.teams, s.teams); assert.deepEqual(imported.log, s.log);
  assert.equal(imported.length, 720); assert.equal(imported.stamp, 5000);
  assert.equal(imported.running, false); assert.equal(imported.shotRunning, false);
});

test('running export accounts for elapsed time and imports paused without offline drift', () => {
  const s = initial(); s.stamp = 1000; start(s);
  const json = exportGame(s, 2250);
  const restored = importGame(json, 100000);
  assert.equal(restored.game, 598750); assert.equal(restored.shot, 22750);
  assert.equal(restored.teams.A.players[0].ms, 1250);
  assert.equal(restored.running, false); assert.equal(restored.shotRunning, false);
  assert.equal(s.game, 600000); assert.equal(s.running, true);
});

test('portable break preserves remaining time and expired breaks are cleared', () => {
  const s = initial(); beginBreak(s, 'Timeout', 30, 1000, 'A');
  const json = exportGame(s, 6000);
  const restored = importGame(json, 100000);
  assert.deepEqual(restored.break, { label: 'Timeout', end: 125000 });
  assert.equal(restored.teams.A.timeouts, 2); assert.equal(restored.running, false);
  assert.equal(importGame(exportGame(s, 40000), 50000).break, null);
});

test('import preserves foul-out restrictions, including unresolved on-court foul-out', () => {
  const s = initial(); for (let i = 0; i < 5; i++) stat(s, 'A', 'A0', 'fls');
  const restored = importGame(exportGame(s, 1000));
  assert.equal(restored.teams.A.players[0].out, true);
  assert.equal(start(restored), false);
});

test('reject malformed, legacy, oversized and unsupported backups', () => {
  for (const json of ['{', 'null', '[]', '{}', JSON.stringify(initial()), file(null)]) assert.throws(() => importGame(json));
  const future = JSON.parse(file(initial())); future.version = 2;
  assert.throws(() => importGame(JSON.stringify(future)), /Unsupported/);
  assert.throws(() => importGame(' '.repeat(MAX_BACKUP_BYTES + 1)), /2 MB/);
});

test('reject invalid clocks, settings, roster, stats and eligibility before import', () => {
  const corruptions = [
    s => { s.game = -1; }, s => { s.shot = 1.5; }, s => { s.stamp = null; },
    s => { s.length = 0; }, s => { s.quarter = 5; }, s => { s.running = 'yes'; },
    s => { s.possession = 'C'; }, s => { s.break = { label: 'Timeout', end: -1 }; },
    s => { s.teams.A.players[0].fls = 5; },
    s => { s.teams.A.players[1].id = 'A0'; },
    s => { s.teams.A.players[1].number = 1; },
    s => { s.teams.A.players[5].on = true; },
    s => { s.teams.A.players[0].ms = -5; },
    s => { s.teams.A.score = '0'; },
    s => { s.log = [7]; },
  ];
  for (const corrupt of corruptions) {
    const s = initial(); corrupt(s); assert.throws(() => importGame(file(s)));
  }
});

test('unknown properties are discarded without prototype pollution', () => {
  const json = JSON.parse(file(initial()));
  json.state.extra = 'ignored';
  Object.defineProperty(json.state, '__proto__', { value: { polluted: true }, enumerable: true });
  const restored = importGame(JSON.stringify(json));
  assert.equal(restored.extra, undefined); assert.equal(restored.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test('storage reading does not overwrite corrupt or unavailable data', () => {
  let writes = 0;
  const storage = { getItem: () => '{broken', setItem: () => writes++ };
  assert.throws(() => readGame(storage), /cannot be read/); assert.equal(writes, 0);
  storage.getItem = () => JSON.stringify({});
  assert.throws(() => readGame(storage)); assert.equal(writes, 0);
  storage.getItem = () => { throw new Error('Unavailable'); };
  assert.throws(() => readGame(storage), /Unavailable/);
  storage.setItem = () => { throw new Error('Quota exceeded'); };
  assert.throws(() => writeGame(storage, initial()), /Quota/);
});

test('existing valid storage remains readable without migration', () => {
  assert.deepEqual(readGame({ getItem: () => JSON.stringify(initial()) }), initial());
  assert.deepEqual(readGame({ getItem: () => null }), initial());
  const s = initial(); const validated = validateState(s);
  validated.teams.A.players[0].name = 'Changed';
  assert.notEqual(validated.teams.A.players[0].name, s.teams.A.players[0].name);
});

test('game writes reject unreadable or unexportable states without replacing the saved game', () => {
  let raw = JSON.stringify(initial());
  const storage = { getItem: () => raw, setItem: (key, value) => { raw = value; } };
  const before = raw;
  for (const corrupt of [s => { s.halftime = 15.5; }, s => { s.teams.A.score = Number.MAX_SAFE_INTEGER + 1; }, s => { s.log = Array(10001).fill('Entry'); }, s => { s.log = ['x'.repeat(MAX_BACKUP_BYTES)]; }]) {
    const s = initial(); corrupt(s);
    assert.throws(() => writeGame(storage, s)); assert.equal(raw, before); assert.equal(s.gameId, null);
    assert.deepEqual(readGame(storage), initial());
  }
});

test('conditional game writes preserve a newer action and support initially empty storage', () => {
  let raw = null; const storage = { getItem: () => raw, setItem: (key, value) => { assert.equal(key, KEY); raw = value; } };
  const first = initial(); writeGame(storage, first, null); const expected = raw;
  const stale = readGame(storage), latest = readGame(storage); stat(latest, 'B', 'B0', 'reb'); writeGame(storage, latest, expected);
  const newer = raw; stat(stale, 'A', 'A0', 'pts', 3);
  assert.throws(() => writeGame(storage, stale, expected), /game changed/); assert.equal(raw, newer);
  const replacement = initial(); assert.throws(() => writeGame(storage, replacement, null), /game changed/); assert.equal(replacement.gameId, null);
});

test('backups reject running clocks during breaks, violations, foul-outs or expired time', () => {
  for (const change of [s => { s.break = { label: 'Timeout', end: 1000 }; }, s => { s.violation = true; }, s => { s.teams.A.players[0].out = true; }, s => { s.game = 0; }, s => { s.shot = 0; }]) {
    const s = initial(); start(s); change(s); assert.throws(() => validateState(s)); assert.throws(() => importGame(file(s)));
  }
});

test('export validates projected horn entries instead of producing an unrestorable backup', () => {
  const s = initial(); s.stamp = 1000; s.log = Array(10000).fill('Recorded entry'); start(s);
  const before = structuredClone(s); assert.throws(() => exportGame(s, 30000), /10000/); assert.deepEqual(s, before);
  for (const now of [-1, NaN, Infinity, 1.5]) {
    assert.throws(() => exportGame(initial(), now), /timestamp/); assert.throws(() => importGame(file(initial()), now), /timestamp/);
  }
});
