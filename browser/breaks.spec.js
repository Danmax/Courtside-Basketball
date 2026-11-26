import { test, expect } from '@playwright/test';
import { initial } from '../src/engine.js';

for (const type of ['timeout', 'halftime']) {
  test(`${type} keeps controller usable and scoreboard scores visible`, async ({ page, context }) => {
    await page.goto('/');
    const state = initial(); state.teams.A.score = 37; state.teams.B.score = 29;
    await page.evaluate(state => localStorage.setItem('basketball_modular_v1', JSON.stringify(state)), state);
    await page.reload();
    const display = await context.newPage(); await display.setViewportSize({ width: 1920, height: 1080 });
    await display.goto('/?view=scoreboard');
    const overlay = await context.newPage(); await overlay.goto('/?view=overlay');
    const referee = await context.newPage(); await referee.goto('/?view=referee');
    await page.getByRole('button', { name: 'Start game + shot', exact: true }).click();
    if (type === 'timeout') {
      await page.locator('article').first().getByText('Timeout · 3 left', { exact: true }).click();
      await page.locator('article').first().getByRole('button', { name: 'Timeout 30', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Halftime', exact: true }).click();
    }
    await expect(page.locator('#break')).not.toBeVisible();
    await expect(referee.locator('#break')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'End break', exact: true })).toBeVisible();
    await expect(overlay.locator('#break')).not.toBeVisible();
    await expect(display.locator('#break')).toBeVisible();
    await expect(display.locator('#breakLabel')).toHaveText(type === 'timeout' ? 'Home TIMEOUT' : 'HALFTIME');
    await expect(display.locator('#breakTime')).toHaveText(type === 'timeout' ? /00:[23]\d/ : /1[45]:\d\d/);
    await expect(display.locator('#AValue')).toHaveText('37'); await expect(display.locator('#BValue')).toHaveText('29');
    await expect(display.getByRole('button')).toHaveCount(0);
    const score = await display.locator('.board').boundingBox(), banner = await display.locator('#break').boundingBox();
    expect(score.y).toBeGreaterThanOrEqual(0); expect(score.y + score.height).toBeLessThanOrEqual(banner.y);
    expect(banner.y + banner.height).toBeLessThanOrEqual(1080);
    const stats = await display.locator('.broadcast-detail').boundingBox(); expect(stats.y + stats.height).toBeLessThanOrEqual(1080);
    const raw = await page.evaluate(() => localStorage.getItem('basketball_modular_v1'));
    const countdown = await display.locator('#breakTime').textContent();
    await expect.poll(() => display.locator('#breakTime').textContent()).not.toBe(countdown);
    expect(await page.evaluate(() => localStorage.getItem('basketball_modular_v1'))).toBe(raw);
    // Officials can still use roster dialogs during a break.
    await page.getByRole('tab', { name: 'Roster', exact: true }).click();
    await page.locator('[data-player-id="A0"]').getByRole('button', { name: 'Substitute…', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await referee.getByRole('button', { name: 'End break', exact: true }).click();
    await expect(display.locator('#break')).not.toBeVisible();
    await expect(page.locator('.break-controls')).not.toBeVisible();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('basketball_modular_v1')));
    expect(saved.running).toBe(false); expect(saved.shotRunning).toBe(false);
    await expect(display.locator('#gameState')).toHaveText('STOPPED');
  });
}
