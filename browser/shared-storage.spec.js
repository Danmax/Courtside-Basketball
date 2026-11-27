import { test, expect } from '@playwright/test';
import { initial, KEY } from '../src/engine.js';
import { changeState } from '../server/state.js';

const password = 'browser-test-operator-password';
async function api(context, options = {}) {
  const g = initial(); g.gameId = 'database-game';
  const fixture = { state: options.empty ? { revision: 0, game: null, tournament: null } : { revision: 0, game: g, tournament: null }, role: options.role || 'operator', authenticated: options.authenticated !== false, fail: false, hold: false, pending: null, writes: 0 };
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const reply = (status, data, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify({ ...data, serverTime: Date.now() }) });
    if (url.pathname === '/api/config') return reply(200, { storage: 'mysql', authenticated: fixture.authenticated, role: fixture.authenticated ? fixture.role : null });
    if (url.pathname === '/api/session') {
      const data = request.postDataJSON();
      if (data.password !== password) return reply(401, { error: 'Incorrect access password.' });
      fixture.authenticated = true; fixture.role = data.role;
      return reply(200, { authenticated: true, role: data.role }, { 'Set-Cookie': 'courtside_test_session=present; Path=/; HttpOnly; SameSite=Strict' });
    }
    if (!fixture.authenticated) return reply(401, { error: 'Sign in required.' });
    if (url.pathname === '/api/state' && method === 'GET') return reply(200, Number(url.searchParams.get('since')) === fixture.state.revision && url.searchParams.has('since') ? { unchanged: true } : { state: fixture.state });
    if (url.pathname === '/api/state' && method === 'PUT') {
      fixture.writes++;
      if (fixture.role === 'viewer') return reply(403, { error: 'Display access is read-only.' });
      if (fixture.fail) return reply(503, { error: 'The shared database is unavailable.' });
      if (fixture.hold) await new Promise(resolve => { fixture.pending = resolve; });
      try { const body = request.postDataJSON(); fixture.state = { ...changeState(fixture.state, body), lastMutationId: body.mutationId }; return reply(200, { state: fixture.state }); }
      catch (error) { return reply(error.status || 400, { error: error.message }); }
    }
    return reply(404, { error: 'Not found' });
  });
  return fixture;
}

test('shared saves wait for acknowledgement and a second browser receives the database update', async ({ page, context }) => {
  const fixture = await api(context); await page.goto('/'); await expect(page.locator('#AValue')).toHaveText('0');
  fixture.hold = true; await page.getByRole('button', { name: 'Add 3 points for #1 Player A1', exact: true }).click();
  await expect(page.locator('.database-status')).toContainText('Saving'); await expect(page.locator('#AValue')).toHaveText('0');
  expect(fixture.state.game.teams.A.score).toBe(0); fixture.pending(); fixture.hold = false;
  await expect(page.locator('#AValue')).toHaveText('3'); expect(fixture.state.game.teams.A.players[0].pts).toBe(3);
  const display = await context.newPage(); await display.goto('/?view=scoreboard'); await expect(display.locator('#AValue')).toHaveText('3');
  fixture.state = structuredClone(fixture.state); fixture.state.revision++; fixture.state.game.teams.B.score = 7;
  await expect(display.locator('#BValue')).toHaveText('7'); await expect(page.locator('#BValue')).toHaveText('7');
  await expect(display.getByRole('button')).toHaveCount(0); expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(null);
});

test('database sign-in handles incorrect passwords without storing credentials in browser storage', async ({ page, context }) => {
  await api(context, { authenticated: false }); await page.goto('/');
  await page.getByLabel('Access password', { exact: true }).fill('wrong'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Incorrect'); await expect(page.getByLabel('Access password', { exact: true })).toHaveValue('');
  await page.getByLabel('Access password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#AValue')).toHaveText('0');
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })); expect(stored).not.toContain(password);
  expect((await context.cookies()).find(cookie => cookie.name === 'courtside_test_session').httpOnly).toBe(true);
});

test('copying browser data is explicit, backs it up, stops clocks, and leaves the original untouched', async ({ page, context }) => {
  const fixture = await api(context, { empty: true }); const local = initial(); local.gameId = 'browser-game'; local.teams.A.score = 8; local.running = true; local.stamp = Date.now();
  const original = JSON.stringify(local); await context.addInitScript(({ key, original }) => localStorage.setItem(key, original), { key: KEY, original });
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Choose your game data' })).toBeVisible(); expect(fixture.writes).toBe(0);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Back up & copy browser data', exact: true }).click(); await download;
  await expect(page.locator('#AValue')).toHaveText('8'); expect(fixture.state.game.running).toBe(false); expect(fixture.state.game.shotRunning).toBe(false);
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(original); expect(fixture.state.game.gameId).toBe('browser-game');
});

test('a failed database save keeps scores unchanged and never falls back to local storage', async ({ page, context }) => {
  const fixture = await api(context); await page.goto('/?view=shots'); fixture.fail = true;
  const court = page.getByRole('button', { name: 'Choose shot location on half-court', exact: true }); await court.focus(); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Made · +2 points', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('unavailable');
  expect(fixture.state.game.teams.A.score).toBe(0); expect(fixture.state.game.shots).toHaveLength(0); await expect(page.locator('.shot-marker.pending')).toHaveCount(1);
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(null);
});

test('choosing local mode remains local across navigation and opens matching display links', async ({ page, context }) => {
  const fixture = await api(context); await page.goto('/?storage=local'); await expect(page.locator('#AValue')).toHaveText('0');
  await page.getByRole('button', { name: 'Add 2 points for #1 Player A1', exact: true }).click(); expect(fixture.writes).toBe(0); expect(fixture.state.game.teams.A.score).toBe(0);
  await page.getByRole('link', { name: 'Shot tracker', exact: true }).click(); await expect(page.locator('.database-status')).toContainText('This device only');
  await expect(page.locator('.shot-scorebar')).toContainText('2');
  await expect(page.locator('.display-menu-panel a').first()).toHaveAttribute('href', /storage=local/);
});
