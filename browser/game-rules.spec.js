import { test, expect } from '@playwright/test';
import { initial, stat, removeFromCourt, recordShot } from '../src/engine.js';

const key = 'basketball_modular_v1';
const click = (page, name) => page.getByRole('button', { name, exact: true }).click();
const raw = page => page.evaluate(key => localStorage.getItem(key), key);
async function seed(page, state = initial()) {
  state.gameId ||= 'rules-game'; await page.goto('/'); await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key, state }); await page.reload();
}
async function openRules(page) { await click(page, 'Game rules…'); return page.getByRole('dialog', { name: 'Game rules', exact: true }); }
async function configure(dialog) {
  for (const [name, value] of [['Number of periods', '2'], ['Period length (mm:ss)', '08:00'], ['Halftime minutes', '5'], ['Shot clock seconds', '20'], ['Short shot reset seconds', '10'], ['Personal foul limit', '3'], ['Team foul threshold', '4'], ['Timeouts per team', '2'], ['Short timeout seconds', '45'], ['Full timeout seconds', '90']]) await dialog.getByLabel(name, { exact: true }).fill(value);
  await dialog.getByLabel('Game clock after a score', { exact: true }).selectOption('true');
  await dialog.getByLabel('Reset team fouls', { exact: true }).selectOption('half');
}

test('game rules set opening clocks, half labels, fouls and timeout controls across views', async ({ page, context }) => {
  await seed(page); const dialog = await openRules(page); await configure(dialog); await click(page, 'Apply'); await expect(dialog).not.toBeVisible();
  const saved = JSON.parse(await raw(page)); expect(saved.periods).toBe(2); expect(saved.length).toBe(480); expect(saved.game).toBe(480000); expect(saved.shot).toBe(20000); expect(saved.teams.A.timeouts).toBe(2); expect(saved.teams.B.timeouts).toBe(2);
  await expect(page.locator('#clockTitle')).toHaveText('H1'); await expect(page.locator('#clockValue')).toHaveText('08:00'); await expect(page.getByRole('button', { name: 'Reset shot 10', exact: true })).toBeVisible();
  await expect(page.locator('.game-rules-summary')).toContainText('2 × 8 min');
  const board = await context.newPage(); await board.goto('/?view=scoreboard'); await expect(board.locator('#clockTitle')).toHaveText('H1'); await expect(board.getByRole('button')).toHaveCount(0);
  for (let i = 0; i < 3; i++) await click(page, 'Add foul for #1 Player A1');
  await expect(page.locator('.scoring-table [data-player-id="A0"]')).toContainText('FOULED OUT');
  await page.locator('article').first().getByText('Timeout · 2 left', { exact: true }).click(); await click(page, 'Timeout 45');
  let state = JSON.parse(await raw(page)); expect(state.teams.A.timeouts).toBe(1); expect(state.break.end - Date.now()).toBeGreaterThan(42000);
  await click(page, 'End break'); await click(page, 'Halftime'); state = JSON.parse(await raw(page)); expect(state.break.end - Date.now()).toBeGreaterThan(295000);
  await click(page, 'End break'); await click(page, 'Next period'); await expect(page.locator('#clockTitle')).toHaveText('H2'); await expect(page.locator('#clockValue')).toHaveText('08:00'); expect(JSON.parse(await raw(page)).teams.A.fouls).toBe(0);
});

test('shot tracker obeys the configured short reset and stops both clocks after a make', async ({ page, context }) => {
  await seed(page); const dialog = await openRules(page); await configure(dialog); await click(page, 'Apply'); await expect(dialog).not.toBeVisible();
  const shots = await context.newPage(); await shots.goto('/?view=shots');
  await click(shots, 'Reset shot 10'); expect(JSON.parse(await raw(shots)).shot).toBe(10000);
  await click(shots, 'Start game + shot'); const court = shots.getByRole('button', { name: 'Choose shot location on half-court', exact: true });
  await court.focus(); await shots.keyboard.press('Enter'); await click(shots, 'Made · +2 points');
  const state = JSON.parse(await raw(shots)); expect(state.teams.A.score).toBe(2); expect(state.shot).toBe(20000); expect(state.running).toBe(false); expect(state.shotRunning).toBe(false);
  await expect(page.locator('#AValue')).toHaveText('2'); await expect(shots.locator('.shot-clock-status > small')).toHaveText('CLOCKS STOPPED');
});

test('rules can disable the shot clock while game timing and scoring remain usable', async ({ page, context }) => {
  await page.clock.install({ time: new Date('2026-11-26T12:00:00Z') }); await seed(page); const dialog = await openRules(page);
  await dialog.getByLabel('Use shot clock', { exact: true }).uncheck(); await click(page, 'Apply'); await expect(dialog).not.toBeVisible();
  await expect(page.locator('#shotValue')).toHaveText('OFF'); await expect(page.getByRole('button', { name: 'Start shot only', exact: true })).toBeDisabled();
  await page.clock.pauseAt(new Date('2026-11-26T12:01:00Z')); await click(page, 'Start game'); await page.clock.fastForward(30000); await expect(page.locator('#clockValue')).toHaveText('09:30');
  await click(page, 'Stop both clocks'); const state = JSON.parse(await raw(page)); expect(state.shot).toBe(24000); expect(state.violation).toBe(false); expect(state.game).toBe(570000);
  const shots = await context.newPage(); await shots.goto('/?view=shots'); await expect(shots.locator('.shot-clock-status > strong')).toHaveText('SHOT OFF');
  await expect(shots.getByRole('button', { name: 'Start game', exact: true })).toBeVisible(); await expect(shots.getByRole('button', { name: 'Reset shot 14', exact: true })).toBeDisabled();
});

test('midgame rule edits preserve clocks and balances and never restore a fouled-out player', async ({ page }) => {
  const state = initial(); for (let i = 0; i < 5; i++) stat(state, 'A', 'A0', 'fls'); removeFromCourt(state, 'A', 'A0');
  stat(state, 'B', 'B0', 'pts', 3); state.game = 123456; state.shot = 12500; state.teams.A.timeouts = 1;
  await seed(page, state); const dialog = await openRules(page); await expect(dialog).toContainText('Current clocks, timeout balances, scores and stats are kept');
  await dialog.getByLabel('Period length (mm:ss)', { exact: true }).fill('12:00'); await dialog.getByLabel('Personal foul limit', { exact: true }).fill('7'); await dialog.getByLabel('Timeouts per team', { exact: true }).fill('6');
  await click(page, 'Apply'); await expect(dialog).not.toBeVisible(); const saved = JSON.parse(await raw(page));
  expect(saved.game).toBe(123456); expect(saved.shot).toBe(12500); expect(saved.teams.A.timeouts).toBe(1); expect(saved.teams.B.score).toBe(3); expect(saved.teams.A.players[0].out).toBe(true);
  await click(page, 'Next period'); expect(JSON.parse(await raw(page)).game).toBe(720000);
});

test('invalid settings, cancellation and app defaults do not change saved rules before Apply', async ({ page }) => {
  await seed(page); const before = await raw(page), dialog = await openRules(page);
  await dialog.getByLabel('Short shot reset seconds', { exact: true }).fill('25'); await click(page, 'Apply'); await expect(dialog.getByRole('alert')).toContainText('cannot exceed'); expect(await raw(page)).toBe(before);
  await click(page, 'Use app defaults'); await expect(dialog.getByLabel('Short shot reset seconds', { exact: true })).toHaveValue('14'); expect(await raw(page)).toBe(before);
  await dialog.getByLabel('Number of periods', { exact: true }).fill('3'); await dialog.getByLabel('Reset team fouls', { exact: true }).selectOption('half');
  await click(page, 'Apply'); await expect(dialog.getByRole('alert')).toContainText('even number'); expect(await raw(page)).toBe(before); await click(page, 'Cancel'); expect(await raw(page)).toBe(before);
});

test('rule submission rechecks running clocks, game identity and rules changed in another tab', async ({ page, context }) => {
  await seed(page); const dialog = await openRules(page); await dialog.getByLabel('Period length (mm:ss)', { exact: true }).fill('12:00');
  const other = await context.newPage(); await other.goto('/'); await click(other, 'Start game + shot'); await click(page, 'Apply'); await expect(dialog.getByRole('alert')).toContainText('Stop both clocks');
  await click(other, 'Stop both clocks'); await click(page, 'Cancel');
  await openRules(page); const changed = JSON.parse(await raw(page)); changed.shotDefault = 30; const updated = JSON.stringify(changed);
  await other.evaluate(({ key, updated }) => localStorage.setItem(key, updated), { key, updated });
  await expect(page.locator('.game-rules-summary')).toContainText('30s shot clock'); await click(page, 'Apply'); await expect(dialog.getByRole('alert')).toContainText('rules changed'); expect(await raw(page)).toBe(updated);
  const replacement = initial(); replacement.gameId = 'new-rules-game'; const replacementRaw = JSON.stringify(replacement); await other.evaluate(({ key, value }) => localStorage.setItem(key, value), { key, value: replacementRaw });
  await click(page, 'Apply'); await expect(dialog.getByRole('alert')).toContainText('game changed'); expect(await raw(page)).toBe(replacementRaw);
});

test('period settings cannot exclude existing shot history, and failed saves preserve the game', async ({ page }) => {
  const state = initial(); recordShot(state, 'A', 'A0', 2, false, .5, .3, 1000); state.shots[0].quarter = 3;
  await seed(page, state); const before = await raw(page), dialog = await openRules(page);
  await dialog.getByLabel('Number of periods', { exact: true }).fill('2'); await click(page, 'Apply'); await expect(dialog.getByRole('alert')).toContainText('already played or recorded'); expect(await raw(page)).toBe(before);
  await dialog.getByLabel('Number of periods', { exact: true }).fill('4');
  await page.evaluate(key => { const write = Storage.prototype.setItem; Storage.prototype.setItem = function(k, value) { if (k === key) throw new Error('Quota exceeded'); return write.call(this, k, value); }; }, key);
  await click(page, 'Apply'); await expect(dialog.getByRole('alert')).toContainText('Quota'); expect(await raw(page)).toBe(before);
});

test('game rules form fits phones and saving returns focus to its controller button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await seed(page); const dialog = await openRules(page);
  const bounds = await dialog.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await dialog.getByLabel('Halftime minutes', { exact: true }).fill('5'); await click(page, 'Apply'); await expect(dialog).not.toBeVisible();
  expect(JSON.parse(await raw(page)).halftime).toBe(5); await expect(page.getByRole('button', { name: 'Game rules…', exact: true })).toBeFocused();
});
