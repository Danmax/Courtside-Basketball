import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { initial } from '../src/engine.js';

const key = 'basketball_modular_v1';
const floor = page => page.locator('.scoring-table [data-player-id="A0"]');
async function seed(page, state) {
  await page.goto('/');
  await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key, state });
  await page.reload();
}

test('active player stat controls score the right player and retain keyboard focus', async ({ page }) => {
  await page.goto('/');
  const row = floor(page);
  const rebound = row.getByRole('button', { name: 'Add rebound for #1 Player A1', exact: true });
  await rebound.click(); await expect(rebound).toBeFocused(); await expect(rebound).toContainText('1');
  await row.getByRole('button', { name: 'Add assist for #1 Player A1', exact: true }).click();
  await row.getByRole('button', { name: 'Add 3 points for #1 Player A1', exact: true }).click();
  await expect(row.locator('.points-cell')).toHaveText('3'); await expect(page.locator('#AValue')).toHaveText('3');
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  expect(saved.teams.A.players[0].reb).toBe(1); expect(saved.teams.A.players[0].ast).toBe(1); expect(saved.possession).toBe('B');
  await expect(page.locator('.bench').first().getByRole('button', { name: /Add .*point/ })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Live scoring', exact: true }).focus();
  await page.keyboard.press('ArrowRight'); await expect(page.getByRole('tab', { name: 'Roster', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Roster', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight'); await expect(page.getByRole('tab', { name: 'Reports', exact: true })).toBeFocused();
});

test('reports include bench stats, ranking, score reconciliation, CSV and print layout', async ({ page }) => {
  const s = initial(); s.teams.A.score = 12; s.teams.A.players[0].pts = 5;
  s.teams.A.players[5].pts = 3; s.teams.A.players[5].reb = 10; s.teams.B.players[0].pts = 21;
  s.teams.A.players[0].name = '<Captain>'; await seed(page, s);
  await page.getByRole('tab', { name: 'Reports', exact: true }).click();
  await expect(page.locator('.score-reconciliation').first()).toContainText('Official score 12 · Player points 8 · Unassigned / score correction +4');
  await expect(page.locator('.leader-list li').first()).toContainText('Player B1');
  await page.getByRole('combobox', { name: 'Rank leaders by' }).selectOption('reb');
  await expect(page.locator('.leader-list li').first()).toContainText('Player A6');
  await expect(page.locator('.boxscore [data-player-id="A5"]')).toContainText('BENCH');
  const promise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download CSV', exact: true }).click();
  const download = await promise; expect(download.suggestedFilename()).toBe('basketball-box-score.csv');
  const csv = await readFile(await download.path(), 'utf8'); expect(csv).toContain('"<Captain>"'); expect(csv).toContain('"Player A6","Bench","3","10"');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.clock-controls')).not.toBeVisible(); await expect(page.locator('.report-actions')).not.toBeVisible();
  await expect(page.locator('.boxscore').first()).toBeVisible(); await expect(page.locator('.board')).toBeVisible();
});

test('phone scoring actions fit the screen without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  const row = floor(page);
  for (const name of ['Add rebound for #1 Player A1', 'Add foul for #1 Player A1', 'Add 3 points for #1 Player A1']) {
    const action = row.getByRole('button', { name, exact: true }); await action.scrollIntoViewIfNeeded();
    const rect = await action.boundingBox(); expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(390);
    expect(rect.height).toBeGreaterThanOrEqual(40);
  }
  await row.getByRole('button', { name: 'Add 3 points for #1 Player A1', exact: true }).click();
  await expect(page.locator('#AValue')).toHaveText('3');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('1080p broadcast views fit and remain read-only while on-floor stats synchronize', async ({ page, context }) => {
  await page.goto('/');
  const display = await context.newPage(); await display.setViewportSize({ width: 1920, height: 1080 });
  await display.goto('/?view=scoreboard');
  await floor(page).getByRole('button', { name: 'Add rebound for #1 Player A1', exact: true }).click();
  await expect(display.locator('[data-player-id="A0"] td').nth(1)).toHaveText('1');
  for (const selector of ['.board', '.broadcast-detail']) {
    const rect = await display.locator(selector).boundingBox(); expect(rect.y).toBeGreaterThanOrEqual(0); expect(rect.y + rect.height).toBeLessThanOrEqual(1080);
  }
  await expect(display.getByRole('button')).toHaveCount(0);
  await display.goto('/?view=overlay');
  const rect = await display.locator('.board').boundingBox(); expect(rect.height).toBeLessThanOrEqual(150); expect(rect.y + rect.height).toBeLessThanOrEqual(1080);
  expect(await display.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await expect(display.getByRole('button')).toHaveCount(0);
});
