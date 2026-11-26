import test from 'node:test';
import assert from 'node:assert/strict';
import { COURT, threeJoinY, threePointPath, fieldGoalValue } from '../src/court-geometry.js';
import { initial, recordShot } from '../src/engine.js';
const at = (x, y) => fieldGoalValue(x / COURT.width, y / COURT.height);

test('paint, midrange and the basket are two-point locations; beyond the arc is three', () => {
  assert.equal(at(250, 64), 2); assert.equal(at(250, 210), 2); assert.equal(at(250, 280), 2);
  assert.equal(at(250, 300), 3); assert.equal(at(100, 300), 3); assert.equal(at(400, 300), 3);
});
test('both straight corner lines and their visible strokes count as two', () => {
  for (const y of [20, 64, 100, threeJoinY]) {
    assert.equal(at(45, y), 2); assert.equal(at(455, y), 2);
    assert.equal(at(44, y), 2); assert.equal(at(456, y), 2);
    assert.equal(at(43.9, y), 3); assert.equal(at(456.1, y), 3);
    assert.equal(at(46, y), 2); assert.equal(at(454, y), 2);
  }
});
test('the arc and stroke count as two; points immediately beyond the stroke count as three', () => {
  for (const angle of [25, 45, 90, 135, 155]) {
    const a = angle * Math.PI / 180;
    for (const [radius, expected] of [[219, 2], [220, 2], [221, 2], [221.1, 3]]) {
      assert.equal(at(COURT.hoopX + Math.cos(a) * radius, COURT.hoopY + Math.sin(a) * radius), expected);
    }
  }
});
test('drawing joins the corner lines to the exact scoring circle and uses the same units', () => {
  assert.ok(Math.abs(Math.hypot(COURT.cornerX - COURT.hoopX, threeJoinY - COURT.hoopY) - COURT.threeRadius) < 1e-10);
  assert.ok(threePointPath().includes('V ' + threeJoinY));
  assert.equal(at(45, threeJoinY + .1), 2); assert.equal(at(455, threeJoinY + .1), 2);
});
test('invalid normalized coordinates are rejected, and decisions are symmetric across the court', () => {
  for (const [x, y] of [[NaN, .5], [Infinity, .5], [-.1, .5], [.5, 1.1], ['.5', .5]]) assert.equal(fieldGoalValue(x, y), null);
  for (const x of [.05, .1, .2, .4]) for (const y of [.1, .3, .5, .7, .9]) assert.equal(fieldGoalValue(x, y), fieldGoalValue(1 - x, y));
});
test('engine computes both made and missed values and updates matching shooting/point records', () => {
  const s = initial();
  recordShot(s, 'A', 'A0', 2, true, .1, .65, 1000);
  recordShot(s, 'A', 'A0', 3, true, .5, .3, 2000);
  recordShot(s, 'A', 'A0', 2, false, .95, .1, 3000);
  assert.deepEqual(s.shots.map(shot => shot.value), [3, 2, 3]);
  assert.equal(s.teams.A.score, 5); assert.equal(s.teams.A.players[0].pts, 5);
});

test('new scoring geometry does not reclassify old manually recorded shots on import', async () => {
  const { exportGame, importGame } = await import('../src/game-transfer.js');
  const s = initial(); recordShot(s, 'A', 'A0', 2, true, .5, .3, 1000);
  s.shots[0].value = 3; s.teams.A.score = s.teams.A.players[0].pts = 3;
  const restored = importGame(exportGame(s, 1000), 2000);
  assert.equal(restored.shots[0].value, 3); assert.equal(restored.teams.A.score, 3);
});
