import { test, expect } from '@playwright/test';

const key = 'basketball_modular_v1';
const state = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
const click = (page, name) => page.getByRole('button', { name, exact: true }).click();

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('roster add/edit validation, deletion, substitution and focus return', async ({ page }) => {
  await page.getByRole('tab', { name: 'Roster', exact: true }).click();
  const home = page.locator('article').first();
  await home.getByRole('button', { name: 'Add player…', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('<Captain>');
  await dialog.getByLabel('Jersey number').fill('1');
  await click(page, 'Apply');
  await expect(dialog.getByRole('alert')).toContainText('Unable to apply');
  await dialog.getByLabel('Jersey number').fill('00');
  await click(page, 'Apply');
  await expect(dialog).not.toBeVisible();
  await expect(home.getByRole('button', { name: 'Add player…', exact: true })).toBeFocused();
  const newRow = home.locator('.player').filter({ has: page.getByRole('heading', { name: '<Captain>', exact: true }) });
  await expect(newRow).toBeVisible();
  await newRow.getByRole('button', { name: 'Edit…', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Captain edited');
  await click(page, 'Apply');
  await expect(newRow).toHaveCount(0);
  const edited = home.locator('.player').filter({ has: page.getByRole('heading', { name: 'Captain edited', exact: true }) });
  await expect(edited).toBeVisible();
  await home.locator('.player').first().getByRole('button', { name: 'Substitute…', exact: true }).click();
  await dialog.getByLabel('Incoming player').selectOption({ label: '#00 Captain edited' });
  await click(page, 'Apply');
  await expect(edited).toContainText('ON COURT');
  await expect(edited.getByRole('button', { name: 'Delete player', exact: true })).toBeDisabled();
  const unused = home.locator('.player').filter({ has: page.getByRole('heading', { name: 'Player A7', exact: true }) });
  page.once('dialog', modal => modal.accept());
  await unused.getByRole('button', { name: 'Delete player', exact: true }).click();
  await expect(unused).toHaveCount(0);
});

test('official clock entry and independent shot controls', async ({ page }) => {
  await click(page, 'Set game time…');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Time (minutes:seconds.milliseconds)', { exact: true }).fill('00:12.345');
  await click(page, 'Apply');
  expect((await state(page)).game).toBe(12345);
  await click(page, 'Set shot time…');
  await dialog.getByLabel('Time (minutes:seconds.milliseconds)', { exact: true }).fill('00:06.500');
  await click(page, 'Apply');
  await click(page, 'Start shot only');
  await expect.poll(async () => Number(await page.locator('#shotValue').textContent())).toBeLessThan(7);
  expect((await state(page)).game).toBe(12345);
  await expect(page.getByRole('button', { name: 'Set game time…', exact: true })).toBeDisabled();
  await click(page, 'Stop shot only');
  expect((await state(page)).shot).toBeLessThan(6500);
  await expect(page.getByRole('button', { name: 'Set game time…', exact: true })).toBeEnabled();
  await click(page, 'Set game time…');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Set game time…', exact: true })).toBeFocused();
});

test('foul-out without bench and reset preserving roster', async ({ page }) => {
  await page.evaluate(key => {
    const s = JSON.parse(localStorage.getItem(key));
    // Initial render does not persist until the first action.
    if (s) throw new Error('Expected fresh browser storage');
  }, key);
  await click(page, 'Stop both clocks');
  await page.evaluate(key => {
    const s = JSON.parse(localStorage.getItem(key));
    s.teams.A.name = 'Falcons';
    s.teams.A.players = s.teams.A.players.slice(0, 5);
    localStorage.setItem(key, JSON.stringify(s));
  }, key);
  await page.reload();
  let row = page.locator('article').first().locator('.player').first();
  for (let i = 0; i < 5; i++) await row.getByRole('button', { name: 'Add foul for #1 Player A1', exact: true }).click();
  await expect(row).toContainText('FOULED OUT');
  await click(page, 'Start game + shot');
  expect((await state(page)).running).toBe(false);
  await row.getByRole('button', { name: 'Substitute…', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('No eligible bench players');
  await click(page, 'Cancel');
  await page.getByRole('button', { name: 'Remove from court', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Put on court', exact: true })).toHaveCount(0);
  await click(page, 'Start game + shot');
  expect((await state(page)).running).toBe(true);
  await click(page, 'Stop both clocks');
  await page.getByText('Game settings & reset', { exact: true }).click();
  page.once('dialog', modal => modal.accept());
  await click(page, 'Reset game (keep rosters)');
  await expect(page.locator('article').first().locator('.player').first()).not.toContainText('FOULED OUT');
  const s = await state(page);
  expect(s.teams.A.name).toBe('Falcons'); expect(s.teams.A.players).toHaveLength(5);
  expect(s.teams.A.players.every(p => !p.out && p.fls === 0)).toBe(true);
  expect(s.running).toBe(false); expect(s.log).toEqual([]);
});

test('broadcasts synchronize without writing and referee has clock-only controls', async ({ page, context }) => {
  await click(page, 'Stop both clocks');
  const scoreboard = await context.newPage(); await scoreboard.goto('/?view=scoreboard');
  const overlay = await context.newPage(); await overlay.goto('/?view=overlay');
  await page.locator('article').first().getByLabel('Team name', { exact: true }).fill('<Home>');
  await page.locator('article').first().getByLabel('Team name', { exact: true }).press('Tab');
  await expect(scoreboard.locator('#ATitle')).toHaveText('<Home>');
  await expect(overlay.locator('#ATitle')).toHaveText('<Home>');
  await click(page, 'Start game + shot');
  await expect(scoreboard.locator('#clockMeta')).toContainText('Game running');
  // Leave only read-only views open: storage must stay unchanged while display counts down.
  await page.close();
  const saved = await scoreboard.evaluate(key => localStorage.getItem(key), key);
  await expect.poll(() => scoreboard.locator('#clockValue').textContent()).not.toBe('10:00');
  expect(await overlay.evaluate(key => localStorage.getItem(key), key)).toBe(saved);
  await expect(scoreboard.getByRole('button')).toHaveCount(0);
  await expect(overlay.getByRole('button')).toHaveCount(0);
  const referee = await context.newPage(); await referee.goto('/?view=referee');
  await expect(referee.getByRole('button', { name: 'Set game time…', exact: true })).toBeVisible();
  await expect(referee.getByRole('button', { name: 'Add player…', exact: true })).toHaveCount(0);
});

test('break expiration restores controls and requires manual restart', async ({ page }) => {
  await click(page, 'Stop both clocks');
  await page.evaluate(key => {
    const s = JSON.parse(localStorage.getItem(key));
    s.break = { label: 'Test timeout', end: Date.now() + 1000 };
    localStorage.setItem(key, JSON.stringify(s));
  }, key);
  await page.reload();
  await expect(page.locator('#break')).not.toBeVisible();
  await expect(page.locator('.break-controls')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set game time…', exact: true })).toBeDisabled();
  await expect(page.locator('.break-controls')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Set game time…', exact: true })).toBeEnabled();
  const s = await state(page);
  expect(s.running).toBe(false); expect(s.shotRunning).toBe(false);
  expect(s.game).toBe(600000); expect(s.shot).toBe(24000);
});

test('open substitution form revalidates a player fouled out in another tab', async ({ page, context }) => {
  await click(page, 'Stop both clocks');
  const row = page.locator('article').first().locator('.player').first();
  await row.getByRole('button', { name: 'Substitute…', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const other = await context.newPage(); await other.goto('/');
  await other.evaluate(key => {
    const s = JSON.parse(localStorage.getItem(key));
    s.teams.A.players.find(p => p.id === 'A5').out = true;
    localStorage.setItem(key, JSON.stringify(s));
  }, key);
  await expect(page.locator('article').first().locator('.player').nth(5)).toContainText('FOULED OUT');
  await dialog.getByLabel('Incoming player').selectOption('A5');
  await click(page, 'Apply');
  await expect(dialog.getByRole('alert')).toContainText('Unable to apply');
  expect((await state(page)).teams.A.players.find(p => p.id === 'A5').on).toBe(false);
  await dialog.getByLabel('Incoming player').selectOption('A6');
  await click(page, 'Apply');
  await expect(dialog).not.toBeVisible();
  expect((await state(page)).teams.A.players.find(p => p.id === 'A6').on).toBe(true);
});

test('start game clears an expired shot-clock violation and synchronizes the restart', async ({ page, context }) => {
  const scoreboard = await context.newPage(); await scoreboard.goto('/?view=scoreboard');
  await click(page, 'Set shot time…');
  await page.getByRole('dialog').getByLabel('Time (minutes:seconds.milliseconds)', { exact: true }).fill('00:00.100');
  await click(page, 'Apply'); await click(page, 'Start shot only');
  await expect.poll(async () => (await state(page)).violation).toBe(true);
  await expect(scoreboard.locator('#gameState')).toHaveText('VIOLATION');
  const owner = (await state(page)).possession;
  await click(page, 'Start game + shot');
  const restarted = await state(page);
  expect(restarted.violation).toBe(false); expect(restarted.running).toBe(true); expect(restarted.shotRunning).toBe(true);
  expect(restarted.shot).toBeGreaterThan(0); expect(restarted.shot).toBeLessThanOrEqual(restarted.shotDefault * 1000); expect(restarted.possession).toBe(owner);
  await expect(scoreboard.locator('#gameState')).toHaveText('LIVE');
  await click(page, 'Stop both clocks');
});
