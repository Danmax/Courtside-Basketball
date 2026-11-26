import { test, expect } from '@playwright/test';
import { initial } from '../src/engine.js';
import { initialTournament, saveTeam, savePlayer, saveMatch, prepareMatchGame, recordResult } from '../src/tournament.js';
const key = 'basketball_modular_v1';
const click = (page, name) => page.getByRole('button', { name, exact: true }).click();
const saved = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
async function seed(page, game = initial(), tournament = null) {
  game.gameId ||= 'shot-controls-test'; await page.goto('/?view=shots');
  await page.evaluate(({ key, game, tournament }) => { localStorage.setItem(key, JSON.stringify(game)); if (tournament) localStorage.setItem('basketball_tournament_v1', JSON.stringify(tournament)); }, { key, game, tournament });
  await page.reload();
}
async function setTime(page, clock, time) {
  await click(page, `Set ${clock} time…`);
  await page.getByRole('dialog').getByLabel('Time (minutes:seconds.milliseconds)', { exact: true }).fill(time);
  await click(page, 'Apply'); await expect(page.getByRole('dialog')).not.toBeVisible();
}

test('shot tracker controls both clocks, independent shot timing, exact time and violation restart', async ({ page, context }) => {
  await seed(page); const board = await context.newPage(); await board.goto('/?view=scoreboard');
  await click(page, 'Start game + shot'); let s = await saved(page); expect(s.running).toBe(true); expect(s.shotRunning).toBe(true);
  await expect(board.locator('#gameState')).toHaveText('LIVE');
  const raw = await page.evaluate(key => localStorage.getItem(key), key), clockText = await page.locator('.shot-clock-status > span').textContent();
  await expect.poll(() => page.locator('.shot-clock-status > span').textContent()).not.toBe(clockText);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw); // Projection adds no background clock writer.
  await click(page, 'Stop shot only'); s = await saved(page); expect(s.running).toBe(true); expect(s.shotRunning).toBe(false);
  await click(page, 'Reset shot 14'); s = await saved(page); expect(s.shot).toBe(14000); expect(s.shotRunning).toBe(false);
  await click(page, 'Start shot only'); expect((await saved(page)).shotRunning).toBe(true);
  await click(page, 'Stop both clocks');
  await setTime(page, 'game', '02:15.250'); s = await saved(page); expect(s.game).toBe(135250); expect(s.running).toBe(false); expect(s.shotRunning).toBe(false);
  await setTime(page, 'shot', '00:00.100'); await click(page, 'Start shot only');
  await expect(page.locator('.shot-clock-status > small')).toHaveText('SHOT CLOCK VIOLATION');
  await click(page, 'Start game + shot'); s = await saved(page);
  expect(s.violation).toBe(false); expect(s.shot).toBeGreaterThan(23000); expect(s.running).toBe(true); expect(s.shotRunning).toBe(true);
  await expect(board.locator('#gameState')).toHaveText('LIVE'); await click(page, 'Stop both clocks');
});

test('selected-player stat buttons preserve marked shots and synchronize fouls and foul-out guards', async ({ page, context }) => {
  await seed(page); const court = page.getByRole('button', { name: 'Choose shot location on half-court', exact: true });
  await court.focus(); await page.keyboard.press('Enter');
  for (const noun of ['rebound', 'assist', 'steal', 'block', 'foul']) await click(page, `Add ${noun} for #1 Player A1`);
  let s = await saved(page), p = s.teams.A.players[0];
  for (const stat of ['reb', 'ast', 'stl', 'blk', 'fls']) expect(p[stat]).toBe(1);
  expect(s.shots).toHaveLength(0); expect(s.teams.A.score).toBe(0); expect(s.teams.A.fouls).toBe(1);
  await expect(page.locator('.shot-marker.pending')).toHaveCount(1);
  await click(page, 'Start game + shot'); await click(page, 'Stop both clocks');
  await expect(page.locator('.shot-marker.pending')).toHaveCount(1);
  await click(page, 'Select team Away'); await click(page, 'Select #3 Player B3'); await click(page, 'Add assist for #3 Player B3');
  s = await saved(page); expect(s.teams.B.players[2].ast).toBe(1); expect(s.teams.A.players[0].ast).toBe(1);
  await click(page, 'Start game + shot');
  for (let i = 0; i < 5; i++) await click(page, 'Add foul for #3 Player B3');
  s = await saved(page); expect(s.teams.B.players[2].out).toBe(true); expect(s.running).toBe(false); expect(s.shotRunning).toBe(false);
  await expect(page.getByRole('button', { name: 'Start game + shot', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add assist for #3 Player B3', exact: true })).toBeDisabled();
  await expect(page.locator('.shot-other-stats')).toContainText('FOULED OUT');
  const board = await context.newPage(); await board.goto('/?view=scoreboard'); await expect(board.locator('#BMeta')).toContainText('Fouls 5');
});

test('breaks block restart and corrections until ended manually, then remain paused', async ({ page }) => {
  const game = initial(); game.break = { label: 'Home TIMEOUT', end: Date.now() + 30000 }; await seed(page, game);
  await expect(page.getByRole('button', { name: 'Start game + shot', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Set game time…', exact: true })).toBeDisabled();
  await click(page, 'End break'); let s = await saved(page);
  expect(s.break).toBe(null); expect(s.running).toBe(false); expect(s.shotRunning).toBe(false);
  await expect(page.getByRole('button', { name: 'Start game + shot', exact: true })).toBeEnabled();
  await page.locator('.shot-bench-picker > summary').click(); await click(page, 'View #6 Player A6');
  await expect(page.getByRole('button', { name: 'Add rebound for #6 Player A6', exact: true })).toBeDisabled();
});

test('archived matches hide clock and stat editing while retaining recorded stat totals', async ({ page }) => {
  const t = initialTournament(); for (const name of ['Home', 'Away']) { saveTeam(t, null, name); savePlayer(t, t.teams.at(-1).id, null, 'Captain', 1); }
  saveMatch(t, null, { homeId: t.teams[0].id, awayId: t.teams[1].id, scheduledAt: '', court: '' });
  const match = prepareMatchGame(t, t.matches[0].id, initial()); match.teams.A.score = 3; match.teams.A.players[0].reb = 4;
  recordResult(t, t.matches[0].id, 3, 0, 1000, match); await seed(page, initial(), t);
  const before = await saved(page); await page.getByLabel('Game source', { exact: true }).selectOption('match:' + t.matches[0].id);
  await expect(page.getByRole('button', { name: 'Start game + shot', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Selected player stat controls', exact: true })).toHaveCount(0);
  await expect(page.locator('.shot-recorded-stats')).toContainText('4 REB'); expect(await saved(page)).toEqual(before);
});

test('a clock correction dialog cannot write to a different game loaded in another tab', async ({ page, context }) => {
  await seed(page); await click(page, 'Set game time…');
  await page.getByRole('dialog').getByLabel('Time (minutes:seconds.milliseconds)', { exact: true }).fill('00:30.000');
  const other = await context.newPage(); await other.goto('/'); const replacement = initial(); replacement.gameId = 'replacement-game';
  await other.evaluate(({ key, replacement }) => localStorage.setItem(key, JSON.stringify(replacement)), { key, replacement });
  await expect(page.locator('.shot-scorebar')).toContainText('10:00');
  await click(page, 'Apply'); await expect(page.getByRole('dialog').getByRole('alert')).toContainText('game changed');
  expect(await saved(page)).toEqual(replacement); await click(page, 'Cancel');
});

test('phone clock and stat controls fit and update the selected player', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await seed(page);
  for (const name of ['Start game + shot', 'Stop both clocks', 'Set shot time…', 'Add rebound for #1 Player A1']) {
    const button = page.getByRole('button', { name, exact: true }); const bounds = await button.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  }
  await click(page, 'Start game + shot'); await click(page, 'Add rebound for #1 Player A1'); await click(page, 'Stop both clocks');
  expect((await saved(page)).teams.A.players[0].reb).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
