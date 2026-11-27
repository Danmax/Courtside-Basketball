import { test, expect } from '@playwright/test';
import { initial } from '../src/engine.js';

const key = 'basketball_modular_v1';
const click = (page, name) => page.getByRole('button', { name, exact: true }).click();
const raw = page => page.evaluate(key => localStorage.getItem(key), key);
async function seed(page, view = '/', state = initial()) {
  await page.goto(view); state.gameId = 'ux-game';
  await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key, state }); await page.reload();
}

test('navigation identifies the current page, scrolls on phones, and keeps display links read-only', async ({ page }) => {
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await seed(page, '/?view=shots'); const before = await raw(page);
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'Shot tracker', exact: true })).toHaveAttribute('aria-current', 'page');
    const tops = await nav.getByRole('link').evaluateAll(links => links.map(link => Math.round(link.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const active = await nav.locator('[aria-current=page]').boundingBox(); expect(active.x).toBeGreaterThanOrEqual(0); expect(active.x + active.width).toBeLessThanOrEqual(width);
    const summary = page.locator('.display-menu > summary'); await summary.focus(); await page.keyboard.press('Enter');
    const menu = page.locator('.display-menu-panel'); await expect(menu).toBeVisible(); await expect(menu.getByRole('link')).toHaveCount(3);
    for (const link of await menu.getByRole('link').all()) { await expect(link).toHaveAttribute('target', '_blank'); await expect(link).toHaveAttribute('rel', 'noopener'); }
    await page.keyboard.press('Escape'); await expect(menu).not.toBeVisible(); await expect(summary).toBeFocused(); expect(await raw(page)).toBe(before);
  }
});

test('skip link reaches the workspace and controller tabs survive reload without changing game data', async ({ page }) => {
  await seed(page); const before = await raw(page);
  await page.keyboard.press('Tab'); const skip = page.getByRole('link', { name: 'Skip to main content' }); await expect(skip).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.locator('#app')).toBeFocused();
  await page.getByRole('tab', { name: 'Reports', exact: true }).click(); await expect(page).toHaveURL(/#reports$/); await page.reload();
  await expect(page.getByRole('tab', { name: 'Reports', exact: true })).toHaveAttribute('aria-selected', 'true'); expect(await raw(page)).toBe(before);
  await skip.focus(); await page.keyboard.press('Enter'); await expect(page).toHaveURL(/#reports$/);
  await page.evaluate(() => { location.hash = 'roster'; }); await expect(page.getByRole('tab', { name: 'Roster', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goto('/?view=tournament#standings'); await expect(page.getByRole('tab', { name: 'Standings', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Matches', exact: true }).click(); await expect(page).toHaveURL(/#matches$/); await page.reload();
  await expect(page.getByRole('tab', { name: 'Matches', exact: true })).toHaveAttribute('aria-selected', 'true'); expect(await raw(page)).toBe(before);
});

for (const view of ['/', '/?view=shots']) {
  test(`live clock controls remain reachable while scrolling ${view}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await seed(page, view);
    if (view.includes('shots')) {
      const court = page.getByRole('button', { name: 'Choose shot location on half-court', exact: true }); await court.focus(); await page.keyboard.press('Enter');
    }
    const bar = page.getByRole('region', { name: 'Live game controls', exact: true }); await bar.waitFor();
    await page.evaluate(() => window.scrollTo(0, 750));
    const bounds = await bar.boundingBox();
    expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeLessThanOrEqual(8); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    for (const name of ['Start game + shot', 'Stop both clocks', 'Reset shot 24']) {
      const button = page.getByRole('button', { name, exact: true }); await expect(button).toHaveCount(1);
      const buttonBounds = await button.boundingBox(); expect(buttonBounds.height).toBeGreaterThanOrEqual(44); expect(buttonBounds.y).toBeLessThan(200);
    }
    await click(page, 'Start game + shot'); expect(JSON.parse(await raw(page)).running).toBe(true); await click(page, 'Stop both clocks'); await click(page, 'Reset shot 24');
    expect(JSON.parse(await raw(page)).shot).toBe(24000); expect(JSON.parse(await raw(page)).running).toBe(false);
    if (view.includes('shots')) await expect(page.locator('.shot-marker.pending')).toHaveCount(1);
    const before = await raw(page); await page.getByRole('link', { name: 'Clock tools', exact: true }).click(); await expect(page.locator('#clock-tools')).toBeFocused(); expect(await raw(page)).toBe(before);
  });
}

test('clock buttons retain keyboard focus and default reset uses current rule settings', async ({ page }) => {
  await seed(page); const start = page.getByRole('button', { name: 'Start game + shot', exact: true }); await start.focus(); await page.keyboard.press('Enter');
  await expect(start).toBeFocused(); await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Stop both clocks', exact: true })).toBeFocused();
  await page.keyboard.press('Enter'); expect(JSON.parse(await raw(page)).running).toBe(false);
  await click(page, 'Game rules…'); const dialog = page.getByRole('dialog'); await dialog.getByLabel('Shot clock seconds', { exact: true }).fill('30');
  await click(page, 'Apply'); await expect(dialog).not.toBeVisible(); await expect(page.getByRole('button', { name: 'Reset shot 30', exact: true })).toBeVisible();
  await click(page, 'Reset shot 30'); expect(JSON.parse(await raw(page)).shot).toBe(30000);
});

test('a blocked restart leads directly to the lineup without replacing the game', async ({ page }) => {
  const state = initial(); state.teams.A.players[0].fls = 5; state.teams.A.players[0].out = true;
  await seed(page, '/', state); const before = await raw(page);
  await expect(page.getByRole('button', { name: 'Start game + shot', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: 'Manage lineup', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Roster', exact: true })).toHaveAttribute('aria-selected', 'true'); expect(await raw(page)).toBe(before);
  await page.locator('[data-player-id="A0"]').getByRole('button', { name: 'Remove from court', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start game + shot', exact: true })).toBeEnabled();
  const saved = JSON.parse(await raw(page)); expect(saved.teams.A.players[0].out).toBe(true); expect(saved.teams.A.players[0].on).toBe(false);
});

test('controller confirmations fade without moving controls and errors remain visible', async ({ page }) => {
  await page.clock.install(); await seed(page); const before = await raw(page);
  const top = () => page.locator('#clock-tools').evaluate(el => el.getBoundingClientRect().top + window.scrollY); const original = await top();
  const download = page.waitForEvent('download'); await click(page, 'Export game'); await download;
  const notice = page.getByRole('status'); await expect(notice).toContainText('Game backup downloaded'); await expect(notice).toHaveCSS('position', 'fixed'); expect(await top()).toBeCloseTo(original, 1);
  await page.clock.fastForward(4000); await expect(notice).not.toBeVisible(); expect(await top()).toBeCloseTo(original, 1);
  await page.getByText('Game settings & reset', { exact: true }).click(); const halftime = page.getByLabel('Halftime minutes', { exact: true }); await halftime.fill('15.5'); await halftime.press('Tab');
  await expect(notice).toContainText('Change unavailable'); await page.clock.fastForward(5000); await expect(notice).toBeVisible(); expect(await raw(page)).toBe(before);
});
