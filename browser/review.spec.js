import { test, expect } from '@playwright/test';
import { initial, recordShot } from '../src/engine.js';
import { exportGame } from '../src/game-transfer.js';
import { initialTournament, saveTeam, savePlayer, saveMatch, prepareMatchGame } from '../src/tournament.js';

const gameKey = 'basketball_modular_v1', tournamentKey = 'basketball_tournament_v1';
const click = (page, name) => page.getByRole('button', { name, exact: true }).click();
const rawGame = page => page.evaluate(key => localStorage.getItem(key), gameKey);
async function seed(page, state = initial(), view = '/') {
  state.gameId ||= 'review-game'; await page.goto(view);
  await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: gameKey, state });
  await page.reload();
}
function tournamentFixture() {
  const t = initialTournament();
  for (const name of ['Wolves', 'Panthers']) { saveTeam(t, null, name); savePlayer(t, t.teams.at(-1).id, null, 'Captain', 1); }
  saveMatch(t, null, { homeId: t.teams[0].id, awayId: t.teams[1].id, scheduledAt: '', court: '' });
  return t;
}

for (const mode of ['Add player', 'Edit player', 'Substitute', 'Set game time']) {
  test(`${mode} dialog cannot change a replacement game with reused player IDs`, async ({ page, context }) => {
    await seed(page);
    if (mode === 'Set game time') await click(page, 'Set game time…');
    else {
      await page.getByRole('tab', { name: 'Roster', exact: true }).click();
      if (mode === 'Add player') await page.locator('article').first().getByRole('button', { name: 'Add player…', exact: true }).click();
      else await page.locator('[data-player-id="A0"]').getByRole('button', { name: mode === 'Edit player' ? 'Edit…' : 'Substitute…', exact: true }).click();
    }
    const dialog = page.getByRole('dialog');
    if (mode.includes('player')) { await dialog.getByLabel('Name', { exact: true }).fill('Old game edit'); await dialog.getByLabel('Jersey number', { exact: true }).fill('12'); }
    if (mode === 'Set game time') await dialog.getByLabel('Time (minutes:seconds.milliseconds)', { exact: true }).fill('00:05.000');
    const other = await context.newPage(); await other.goto('/?view=players');
    const replacement = initial(); replacement.gameId = 'replacement-game'; replacement.teams.A.name = 'New home';
    const raw = JSON.stringify(replacement);
    await other.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: gameKey, raw });
    await expect(page.locator('#ATitle')).toHaveText('New home');
    await click(page, 'Apply'); await expect(dialog.getByRole('alert')).toContainText('game changed');
    expect(await rawGame(page)).toBe(raw); await click(page, 'Cancel');
  });
}

test('countdowns project without writes, then save exact elapsed time when paused', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-26T12:00:00Z') }); await seed(page);
  await page.clock.pauseAt(new Date('2026-11-26T12:01:00Z')); await click(page, 'Start game + shot');
  const raw = await rawGame(page); await page.clock.fastForward(2500);
  expect(await rawGame(page)).toBe(raw); await expect(page.locator('#clockValue')).toHaveText('09:58');
  await click(page, 'Stop both clocks'); const saved = JSON.parse(await rawGame(page));
  expect(saved.game).toBe(597500); expect(saved.shot).toBe(21500); expect(saved.teams.A.players[0].ms).toBe(2500);
  expect(saved.running).toBe(false); expect(saved.shotRunning).toBe(false);
});

test('shot expiration is saved once and never restarts either clock', async ({ page }) => {
  await page.clock.install(); const state = initial(); state.shot = 500; await seed(page, state); await click(page, 'Start game + shot');
  await page.clock.fastForward(1000); const raw = await rawGame(page), saved = JSON.parse(raw);
  expect(saved.violation).toBe(true); expect(saved.running).toBe(false); expect(saved.shotRunning).toBe(false);
  expect(saved.game).toBe(599500); expect(saved.teams.A.players[0].ms).toBe(500);
  expect(saved.log.filter(entry => entry.includes('Shot clock violation:'))).toHaveLength(1);
  await page.clock.fastForward(5000); expect(await rawGame(page)).toBe(raw);
});

test('invalid halftime and blank team names preserve a readable saved game', async ({ page }) => {
  await seed(page); const raw = await rawGame(page);
  await page.getByText('Game settings & reset', { exact: true }).click();
  const halftime = page.getByLabel('Halftime minutes', { exact: true }); await halftime.fill('15.5'); await halftime.press('Tab');
  await expect(page.getByRole('status')).toContainText('Change unavailable'); expect(await rawGame(page)).toBe(raw);
  await expect(halftime).toHaveValue('15');
  const name = page.locator('article').first().getByLabel('Team name', { exact: true }); await name.fill('   '); await name.press('Tab');
  expect(await rawGame(page)).toBe(raw); await expect(name).toHaveValue('Home');
  await click(page, 'Start game + shot'); expect(JSON.parse(await rawGame(page)).running).toBe(true);
});

test('reset confirmation cannot overwrite a game changed while confirmation is open', async ({ page, context }) => {
  await seed(page); await page.getByText('Game settings & reset', { exact: true }).click();
  const other = await context.newPage(); await other.goto('/?view=players');
  const replacement = initial(); replacement.gameId = 'replacement-during-confirm'; replacement.teams.A.score = 18;
  const raw = JSON.stringify(replacement);
  page.once('dialog', async dialog => { await other.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: gameKey, raw }); await dialog.accept(); });
  await click(page, 'Reset game (keep rosters)');
  await expect(page.getByRole('status')).toContainText('game changed'); expect(await rawGame(page)).toBe(raw);
});

test('an old team-name field cannot rename a replacement game when it loses focus', async ({ page, context }) => {
  await seed(page);
  const field = page.locator('article').first().getByLabel('Team name', { exact: true }); await field.fill('Old field edit');
  const other = await context.newPage(); await other.goto('/?view=players');
  const replacement = initial(); replacement.gameId = 'replacement-while-typing'; replacement.teams.A.name = 'New home'; const raw = JSON.stringify(replacement);
  await other.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: gameKey, raw });
  await expect(page.locator('#ATitle')).toHaveText('New home');
  await field.press('Tab'); await expect(page.getByRole('status')).toContainText('game changed');
  expect(await rawGame(page)).toBe(raw); await expect(field).toHaveValue('New home');
});

test('game import refuses to replace a game changed while its confirmation is open', async ({ page, context }) => {
  await seed(page); await click(page, 'Import game…');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('JSON backup', { exact: true }).setInputFiles({ name: 'game.json', mimeType: 'application/json', buffer: Buffer.from(exportGame(initial(), 1000)) });
  await expect(dialog.getByRole('status')).toContainText('Home 0');
  const other = await context.newPage(); await other.goto('/?view=players');
  const replacement = initial(); replacement.gameId = 'new-game-during-import'; replacement.teams.B.score = 20; const raw = JSON.stringify(replacement);
  page.once('dialog', async confirmation => { await other.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: gameKey, raw }); await confirmation.accept(); });
  await click(page, 'Apply'); await expect(dialog.getByRole('status')).toContainText('game changed');
  expect(await rawGame(page)).toBe(raw);
});

test('shot log retains its nodes, focus and scroll during unrelated stat updates', async ({ page, context }) => {
  const state = initial(); for (let i = 0; i < 30; i++) recordShot(state, 'A', 'A0', 2, false, .5, .3, 1000 + i);
  await seed(page, state, '/?view=shots');
  const button = page.locator('[data-shot-id="shot-20"]').getByRole('button', { name: 'Void attempt', exact: true });
  await button.focus(); const list = page.locator('.shot-attempt-list'), scrollTop = await list.evaluate(el => el.scrollTop);
  expect(scrollTop).toBeGreaterThan(0); const original = await button.elementHandle();
  const other = await context.newPage(); await other.goto('/?view=players');
  await other.evaluate(key => { const s = JSON.parse(localStorage.getItem(key)); s.teams.A.players[0].reb = 1; localStorage.setItem(key, JSON.stringify(s)); }, gameKey);
  await expect(page.getByRole('button', { name: 'Add rebound for #1 Player A1', exact: true })).toContainText('1');
  expect(await original.evaluate(el => el.isConnected)).toBe(true); await expect(button).toBeFocused();
  expect(await list.evaluate(el => el.scrollTop)).toBe(scrollTop);
  page.once('dialog', confirmation => confirmation.accept()); await button.click();
  const row = page.locator('[data-shot-id="shot-20"]'); await expect(row).toContainText('VOID'); await expect(row).toBeFocused();
});

test('tournament edit forms reject a newer directory instead of overwriting it', async ({ page, context }) => {
  const tournament = tournamentFixture(); await page.goto('/?view=tournament');
  await page.evaluate(({ key, tournament }) => localStorage.setItem(key, JSON.stringify(tournament)), { key: tournamentKey, tournament }); await page.reload();
  await page.locator('.directory-team').first().getByRole('button', { name: 'Edit team', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel('Team name', { exact: true }).fill('Old name');
  const other = await context.newPage(); await other.goto('/?view=players');
  tournament.teams[0].name = 'New name'; const raw = JSON.stringify(tournament);
  await other.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: tournamentKey, raw });
  await click(page, 'Save team'); await expect(dialog.getByRole('alert')).toContainText('tournament changed');
  expect(await page.evaluate(key => localStorage.getItem(key), tournamentKey)).toBe(raw);
});

test('cancelling a match rechecks whether it was loaded while confirmation was open', async ({ page, context }) => {
  const tournament = tournamentFixture(); await page.goto('/?view=tournament#matches');
  await page.evaluate(({ key, tournament, gameKey, game }) => { localStorage.setItem(key, JSON.stringify(tournament)); localStorage.setItem(gameKey, JSON.stringify(game)); }, { key: tournamentKey, tournament, gameKey, game: initial() }); await page.reload();
  const before = await page.evaluate(key => localStorage.getItem(key), tournamentKey);
  const other = await context.newPage(); await other.goto('/?view=players');
  const game = prepareMatchGame(tournament, tournament.matches[0].id, initial()); game.gameId = 'loaded-during-confirm';
  page.once('dialog', async dialog => { await other.evaluate(({ key, game }) => localStorage.setItem(key, JSON.stringify(game)), { key: gameKey, game }); await dialog.accept(); });
  await click(page, 'Cancel match'); await expect(page.locator('.tournament-notice')).toContainText('on the game desk');
  expect(await page.evaluate(key => localStorage.getItem(key), tournamentKey)).toBe(before);
});

test('broadcast storage warnings clear when another tab restores a valid game', async ({ page, context }) => {
  await seed(page);
  const other = await context.newPage(); await other.goto('/?view=players');
  await other.evaluate(key => localStorage.setItem(key, '{broken'), gameKey);
  await page.goto('/?view=scoreboard'); await expect(page.getByRole('status')).toContainText('cannot be read');
  const restored = initial(); restored.gameId = 'restored-game'; restored.teams.A.score = 21;
  await other.evaluate(({ key, restored }) => localStorage.setItem(key, JSON.stringify(restored)), { key: gameKey, restored });
  await expect(page.locator('#AValue')).toHaveText('21'); await expect(page.getByRole('status')).toHaveCount(0);
  expect(JSON.parse(await rawGame(page))).toEqual(restored); await expect(page.getByRole('button')).toHaveCount(0);
});
