import test from 'node:test';
import assert from 'node:assert/strict';
import { initial, stat, KEY } from '../src/engine.js';
import { initialTournament } from '../src/tournament.js';
import { TOURNAMENT_KEY } from '../src/tournament-storage.js';
import { writeGame } from '../src/storage.js';
import { SharedStorage } from '../src/shared-storage.js';
import { serverConfig } from '../server/config.js';
import { createAuth } from '../server/auth.js';
import { ApiError, changeState, preserveEligibility } from '../server/state.js';

const env = { DB_PASSWORD: 'test-database-password', COURTSIDE_ADMIN_PASSWORD: 'test-operator-password-123', APP_ORIGIN: 'http://127.0.0.1:5173', NODE_ENV: 'test' };
const empty = () => ({ revision: 0, game: null, tournament: null, lastMutationId: null });
const game = () => ({ ...initial(), gameId: 'shared-test-game' });
const input = (value, revision = 0) => ({ key: KEY, value, revision, mutationId: crypto.randomUUID() });

test('server configuration keeps database credentials server-side, uses Hostinger IPv4, and requires secrets', () => {
  const config = serverConfig(env); assert.equal(config.database.host, '127.0.0.1'); assert.equal(config.database.database, 'u130206374_courtside'); assert.equal(config.database.user, 'u130206374_courtsideAdmin');
  assert.equal(config.database.multipleStatements, false); assert.equal(config.database.ssl, undefined);
  assert.throws(() => serverConfig({ ...env, DB_PASSWORD: '' }), /DB_PASSWORD/); assert.throws(() => serverConfig({ ...env, COURTSIDE_ADMIN_PASSWORD: 'short' }), /16/);
  assert.throws(() => serverConfig({ ...env, NODE_ENV: 'production' }), /HTTPS/);
  assert.equal(serverConfig({ ...env, DB_HOST: 'remote.example', DB_SSL: 'false' }).database.ssl.rejectUnauthorized, true);
});

test('signed sessions expire, reject tampering, separate viewer access and use secure cookies in production', () => {
  let now = 1000; const auth = createAuth(serverConfig(env), () => now);
  assert.equal(auth.passwordMatches(env.COURTSIDE_ADMIN_PASSWORD), true); assert.equal(auth.passwordMatches('incorrect'), false);
  const cookie = auth.issue('viewer'); assert.equal(auth.session(cookie).role, 'viewer'); assert.match(cookie, /HttpOnly; SameSite=Strict/);
  assert.equal(auth.session(cookie.replace('courtside_session=', 'courtside_session=x')), null);
  now += 8 * 60 * 60 * 1000; assert.equal(auth.session(cookie), null); assert.match(auth.clear(), /Max-Age=0/);
  const production = createAuth(serverConfig({ ...env, NODE_ENV: 'production', APP_ORIGIN: 'https://courtside.frowear.com' })); assert.match(production.issue(), /^__Host-courtside=/); assert.match(production.issue(), /; Secure$/);
});

test('shared state validates both datasets and rejects stale revisions without modifying the prior state', () => {
  const original = empty(), g = game(); const next = changeState(original, input(g)); assert.equal(next.revision, 1); assert.equal(next.game.gameId, g.gameId); assert.equal(original.game, null);
  const before = structuredClone(next); assert.throws(() => changeState(next, input(g, 0)), /another device/); assert.deepEqual(next, before);
  const invalid = game(); invalid.teams.A.score = -1; assert.throws(() => changeState(next, input(invalid, 1))); assert.deepEqual(next, before);
  assert.throws(() => changeState(next, { ...input(g, 1), key: 'other-table' }), /Unknown/);
  const tournament = initialTournament(), both = changeState(next, { ...input(tournament, 1), key: TOURNAMENT_KEY }); assert.equal(both.tournament.name, tournament.name); assert.equal(both.game.gameId, g.gameId);
});

test('the server cannot revive, remove or re-enter a fouled-out player in the same game', () => {
  const before = game(); for (let i = 0; i < 5; i++) stat(before, 'A', 'A0', 'fls'); before.teams.A.players[0].on = false;
  for (const change of [g => { g.teams.A.players[0].out = false; g.teams.A.players[0].fls = 0; }, g => { g.teams.A.players[0].on = true; }, g => { g.teams.A.players.shift(); }]) {
    const next = structuredClone(before); change(next); assert.throws(() => preserveEligibility(before, next), /cannot return/);
  }
  const next = structuredClone(before); next.personalLimit = 7; assert.doesNotThrow(() => preserveEligibility(before, next));
  next.gameId = 'explicit-new-game'; assert.doesNotThrow(() => preserveEligibility(before, next));
});

test('browser migration is atomic, requires stopped clocks and refuses an existing shared dataset', () => {
  const migration = { operation: 'migrate', revision: 0, mutationId: crypto.randomUUID(), game: game(), tournament: initialTournament() };
  const result = changeState(empty(), migration); assert.equal(result.game.gameId, migration.game.gameId); assert.equal(result.tournament.name, migration.tournament.name);
  assert.throws(() => changeState(result, { ...migration, revision: 1 }), /already has shared data/);
  migration.game.running = true; assert.throws(() => changeState(empty(), migration), /must be stopped/);
});

test('remote writes are acknowledged before assigning a new game identity or changing the cache', async () => {
  let finish;
  const storage = new SharedStorage({ state: empty(), request: (path, options) => new Promise(resolve => { finish = () => resolve({ state: { revision: 1, game: options.body.value, tournament: null, lastMutationId: options.body.mutationId } }); }) });
  const g = initial(), promise = writeGame(storage, g, null); assert.equal(g.gameId, null); assert.equal(storage.getItem(KEY), null);
  finish(); await promise; assert.ok(g.gameId); assert.equal(JSON.parse(storage.getItem(KEY)).gameId, g.gameId);
});

test('failed remote saves do not invent success, and a lost response is reconciled through its receipt', async () => {
  const starting = { ...empty(), game: game() }; let latest = starting, savedId;
  const storage = new SharedStorage({ state: starting, request: async (path, options) => {
    if (options?.method === 'PUT') { const error = new Error('Offline'); error.status = 503; throw error; }
    return { state: latest };
  } });
  const before = storage.getItem(KEY), g = game(); stat(g, 'A', 'A0', 'pts', 2);
  await assert.rejects(storage.save(KEY, JSON.stringify(g), before), /Offline/); assert.equal(storage.getItem(KEY), before);
  storage.request = async (path, options) => {
    if (options?.method === 'PUT') { savedId = options.body.mutationId; latest = { ...starting, revision: 1, game: options.body.value, lastMutationId: savedId }; throw new Error('Response lost'); }
    return { state: latest };
  };
  await storage.save(KEY, JSON.stringify(g), before); assert.equal(storage.state.lastMutationId, savedId); assert.equal(JSON.parse(storage.getItem(KEY)).teams.A.score, 2);
});

test('polling refreshes all revisions, ignores older responses, and read-only adapters never send writes', async () => {
  const starting = { ...empty(), game: game() }; let notifications = 0;
  const storage = new SharedStorage({ state: starting, clock: () => 1000, notify: () => notifications++, request: async () => ({ serverTime: 2000, state: { ...starting, revision: 1 } }) });
  const before = storage.getItem(KEY); await storage.refresh(); assert.notEqual(storage.getItem(KEY), before); assert.equal(notifications, 1); assert.equal(storage.now(), 2000);
  storage.accept(starting); assert.equal(storage.state.revision, 1);
  storage.readOnly = true; await assert.rejects(storage.save(KEY, JSON.stringify(game()), storage.getItem(KEY)), /read-only/);
});

test('polling during an acknowledged save keeps the saving status visible', async () => {
  let acknowledge; const phases = [];
  const storage = new SharedStorage({ state: empty(), clock: () => 1000, status: phase => phases.push(phase), request: async (path, options) => {
    if (options?.method === 'PUT') return new Promise(resolve => { acknowledge = () => resolve({ state: { ...empty(), revision: 1, game: options.body.value } }); });
    return { unchanged: true, serverTime: 1000 };
  } });
  const saving = storage.save(KEY, JSON.stringify(game()), null);
  await storage.refresh(); assert.equal(phases.at(-1), 'saving'); assert.equal(storage.getItem(KEY), null);
  acknowledge(); await saving; assert.equal(phases.at(-1), 'connected'); assert.equal(storage.saving, false);
});
