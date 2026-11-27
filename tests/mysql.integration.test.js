import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { createDatabase } from '../server/database.js';
import { initial, KEY } from '../src/engine.js';

const socketPath = process.env.COURTSIDE_TEST_SOCKET;
test('real MySQL persists both datasets, serializes competing saves and rolls back invalid changes', { skip: !socketPath }, async () => {
  assert.match(socketPath, /^\/private\/tmp\/courtside-mysql-[^/]+\/mysql\.sock$/);
  const admin = await mysql.createConnection({ socketPath, user: 'root' }), name = `courtside_test_${process.pid}`;
  await admin.execute(`CREATE DATABASE ${name}`);
  const database = createDatabase({ socketPath, user: 'root', database: name, connectionLimit: 3, supportBigNumbers: true, bigNumberStrings: true });
  try {
    await database.initialize(); await database.health(); assert.equal((await database.read()).revision, 0);
    const first = initial(); first.gameId = 'mysql-game'; first.teams.A.score = 2;
    const request = { key: KEY, value: first, revision: 0, mutationId: crypto.randomUUID() };
    const competing = { ...request, value: { ...first, possession: 'B' }, mutationId: crypto.randomUUID() };
    const results = await Promise.allSettled([database.write(request), database.write(competing)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
    const current = await database.read(); assert.equal(current.revision, 1); assert.equal(current.game.teams.A.score, 2);
    const winner = results[0].status === 'fulfilled' ? request : competing;
    assert.equal((await database.write(winner)).revision, 1); // Receipt: no duplicate write.
    await assert.rejects(database.write({ ...winner, value: { ...first, quarter: 2 } }), /identifier/);
    const invalid = structuredClone(first); invalid.teams.A.score = -1;
    await assert.rejects(database.write({ ...request, value: invalid, revision: 1, mutationId: crypto.randomUUID() })); assert.equal((await database.read()).revision, 1);
    await database.initialize(); assert.deepEqual(await database.read(), current); assert.equal(await database.read(1), null);
  } finally { await database.close(); await admin.execute(`DROP DATABASE ${name}`); await admin.end(); }
});
