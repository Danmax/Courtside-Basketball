import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { initial, stat } from '../src/engine.js';
import { exportGame } from '../src/game-transfer.js';

const key = 'basketball_modular_v1';
const click = (page, name) => page.getByRole('button', { name, exact: true }).click();
const stored = page => page.evaluate(key => localStorage.getItem(key), key);
const upload = (page, content) => page.getByLabel('JSON backup', { exact: true }).setInputFiles({ name: 'game.json', mimeType: 'application/json', buffer: Buffer.from(content) });

test('download and confirmed import preserve score, roster and paused time across broadcast tabs', async ({ page, context }) => {
  await page.goto('/');
  await page.locator('article').first().getByText('Team score', { exact: true }).click();
  await page.locator('article').first().getByRole('button', { name: 'Score 3', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  const before = await stored(page);
  await click(page, 'Export game');
  const download = await downloadPromise;
  const json = await readFile(await download.path(), 'utf8');
  expect(JSON.parse(json).state.teams.A.score).toBe(3);
  expect(await stored(page)).toBe(before);
  await page.locator('article').first().getByRole('button', { name: 'Score 2', exact: true }).click();
  const broadcast = await context.newPage(); await broadcast.goto('/?view=scoreboard');
  await click(page, 'Import game…'); await upload(page, json);
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Home 3');
  page.once('dialog', dialog => dialog.accept()); await click(page, 'Apply');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(broadcast.locator('#AValue')).toHaveText('3');
  const restored = JSON.parse(await stored(page));
  expect(restored.running).toBe(false); expect(restored.shotRunning).toBe(false);
  expect(restored.teams.A.players).toHaveLength(7);
  await expect(page.getByRole('button', { name: 'Import game…', exact: true })).toBeFocused();
});

test('malformed imports, replacement cancellation and running clocks leave game unchanged', async ({ page }) => {
  await page.goto('/'); await click(page, 'Stop both clocks');
  const before = await stored(page);
  await click(page, 'Import game…'); await upload(page, '{broken');
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('not valid JSON');
  await click(page, 'Apply'); expect(await stored(page)).toBe(before);
  const s = initial(); s.teams.A.name = '<Imported>'; stat(s, 'A', 'A0', 'pts', 2);
  await upload(page, exportGame(s, 1000));
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('<Imported> 2');
  page.once('dialog', dialog => dialog.dismiss()); await click(page, 'Apply');
  expect(await stored(page)).toBe(before);
  await click(page, 'Cancel'); await click(page, 'Start game + shot');
  await click(page, 'Import game…'); await upload(page, exportGame(s, 1000));
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('<Imported> 2');
  await click(page, 'Apply');
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Stop both clocks');
  expect(JSON.parse(await stored(page)).teams.A.name).toBe('Home');
});

test('corrupt storage is preserved, downloadable, and recoverable by explicit import', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(key => localStorage.setItem(key, '{broken'), key); await page.reload();
  await expect(page.locator('main > [role=status]')).toContainText('cannot be read');
  await click(page, 'Start game + shot'); expect(await stored(page)).toBe('{broken');
  const downloadPromise = page.waitForEvent('download'); await click(page, 'Export game');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('basketball-recovery.json');
  expect(await readFile(await download.path(), 'utf8')).toBe('{broken');
  await click(page, 'Import game…'); await upload(page, exportGame(initial(), 1000));
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Home 0');
  page.once('dialog', dialog => dialog.accept()); await click(page, 'Apply');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(JSON.parse(await stored(page)).teams.A.score).toBe(0);
});

test('failed storage writes are visible and never show an unsaved score', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); }; });
  await page.goto('/');
  await page.locator('article').first().getByText('Team score', { exact: true }).click();
  await page.locator('article').first().getByRole('button', { name: 'Score 3', exact: true }).click();
  await expect(page.locator('main > [role=status]')).toContainText('Changes have not been saved');
  await expect(page.locator('#AValue')).toHaveText('0');
  expect(await stored(page)).toBe(null);
});
