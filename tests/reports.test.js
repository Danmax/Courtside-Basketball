import test from 'node:test';
import assert from 'node:assert/strict';
import { initial } from '../src/engine.js';
import { totals, leaders, csvReport } from '../src/reports.js';
import { minutes } from '../src/ui.js';

test('reports include bench activity without conflating official score and player points', () => {
  const s = initial(); s.teams.A.score = 12;
  Object.assign(s.teams.A.players[0], { pts: 5, reb: 4, ast: 2, ms: 12500 });
  Object.assign(s.teams.A.players[5], { pts: 3, reb: 2, ms: 4500 });
  assert.deepEqual(totals(s.teams.A), { pts: 8, reb: 6, ast: 2, stl: 0, blk: 0, fls: 0, ms: 17000 });
  assert.equal(minutes(12500), '0:12'); assert.equal(minutes(60100), '1:00');
  const report = csvReport(s);
  assert.match(report, /"TEAM TOTAL","","8","6","2","0","0","0","0:17","0\/0","—","0\/0","0\/0","12"/);
  assert.match(report, /"Player A6","Bench","3"/);
  assert.equal(s.teams.A.score, 12);
});

test('leaders sort by the selected stat across both full rosters without mutating order', () => {
  const s = initial(); s.teams.A.players[5].reb = 10; s.teams.B.players[0].pts = 21;
  assert.equal(leaders(s, 'pts')[0].id, 'B0');
  assert.equal(leaders(s, 'reb')[0].id, 'A5');
  assert.equal(leaders(s, 'reb')[0].teamName, 'Home');
  assert.equal(leaders(s).length, 5); assert.equal(s.teams.A.players[0].id, 'A0');
  s.teams.A.players = []; s.teams.B.players = []; assert.deepEqual(leaders(s), []);
});

test('CSV escapes quotes, commas, newlines and spreadsheet formulas in user text', () => {
  const s = initial(); s.teams.A.name = '=SUM(A1)'; s.teams.A.players[0].name = 'A, "quoted"\nplayer';
  const csv = csvReport(s);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=SUM(A1)"'));
  assert.ok(csv.includes('"A, ""quoted""\nplayer"'));
  for (const name of ['+1+1', '-1+1', '@SUM(A1)', '  =1+1']) {
    s.teams.A.players[0].name = name;
    assert.ok(csvReport(s).includes('"\'' + name + '"'));
  }
});
