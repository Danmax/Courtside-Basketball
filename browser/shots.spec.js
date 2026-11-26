import { test, expect } from '@playwright/test';
import { initial, recordShot } from '../src/engine.js';
import { initialTournament, saveTeam, savePlayer, saveMatch, prepareMatchGame, recordResult } from '../src/tournament.js';
const key = 'basketball_modular_v1';
const click = (page, name) => page.getByRole('button', { name, exact: true }).click();
async function seed(page, state = initial(), tournament = null) {
  state.gameId ||= 'test-game'; await page.goto('/?view=shots');
  await page.evaluate(({ state, tournament }) => { localStorage.setItem('basketball_modular_v1', JSON.stringify(state)); if (tournament) localStorage.setItem('basketball_tournament_v1', JSON.stringify(tournament)); }, { state, tournament }); await page.reload();
}
async function location(page, x = .3, y = .4) {
  const court = page.getByRole('button', { name: 'Choose shot location on half-court', exact: true }); const bounds = await court.boundingBox(), svg = await court.locator('svg').boundingBox();
  const border = await court.evaluate(el => ({ left: el.clientLeft, top: el.clientTop }));
  // Playwright positions use the padding box; target the nearest actual screen pixel.
  await court.click({ position: { x: Math.round(svg.x + svg.width * x) - bounds.x - border.left, y: Math.round(svg.y + svg.height * y) - bounds.y - border.top } });
}
const read = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);

test('court captures made/missed field goals, synchronizes scores, and supplies shooting stats/reports', async ({ page, context }) => {
  await seed(page); const board = await context.newPage(); await board.goto('/?view=scoreboard');
  await expect(page.getByRole('button', { name: 'Made · +2 points', exact: true })).toBeDisabled();
  await location(page, .1, .65);
  await click(page, 'Made · +3 points'); await expect(page.locator('.shot-marker.made')).toHaveCount(1);
  await expect(page.locator('.shot-marker.pending')).toHaveCount(0); await expect(board.locator('#AValue')).toHaveText('3');
  await expect(page.getByRole('button', { name: 'Made · +3 points', exact: true })).toBeDisabled();
  await location(page, .6, .5); await click(page, 'Missed · attempt only');
  const saved = await read(page); expect(saved.shots).toHaveLength(2); expect(saved.shots[0].x).toBeCloseTo(.1, 2); expect(saved.shots[0].y).toBeCloseTo(.65, 2);
  expect(saved.teams.A.score).toBe(3); expect(saved.teams.A.players[0].pts).toBe(3); expect(saved.possession).toBe('B');
  await expect(page.locator('.shot-summary')).toContainText('1/2'); await expect(page.locator('.shot-summary')).toContainText('50.0%');
  await page.goto('/?view=players'); await expect(page.locator('.player-shooting')).toContainText('1/2'); await expect(page.locator('.player-shooting')).toContainText('50.0%');
  await page.goto('/'); await page.getByRole('tab', { name: 'Reports', exact: true }).click();
  await expect(page.locator('.shooting-report')).toContainText('1/2'); await expect(page.locator('.shooting-report')).toContainText('50.0%');
});

test('keyboard location, free throws and voids maintain correct score and possession', async ({ page }) => {
  await seed(page); const court = page.getByRole('button', { name: 'Choose shot location on half-court', exact: true });
  await court.focus(); await page.keyboard.press('ArrowRight'); await click(page, 'Made · +2 points');
  expect((await read(page)).shots[0].x).toBeCloseTo(.52, 2);
  await click(page, 'Free throw'); await expect(court).toBeDisabled();
  await click(page, 'Made · +1 point'); let state = await read(page); expect(state.teams.A.score).toBe(3); expect(state.possession).toBe('B'); expect(state.shots[1].x).toBe(null);
  page.once('dialog', dialog => dialog.accept()); await page.locator('[data-shot-id="shot-2"]').getByRole('button', { name: 'Void attempt', exact: true }).click();
  state = await read(page); expect(state.teams.A.score).toBe(2); expect(state.shots[1].voided).toBe(true); expect(state.possession).toBe('B');
  await expect(page.locator('[data-shot-id="shot-2"]')).toContainText('VOID'); await expect(page.locator('.shot-summary')).toContainText('0/0');
});

test('bench and freshly fouled-out players cannot record shots through an open capture page', async ({ page, context }) => {
  await seed(page); await page.locator('.shot-bench-picker > summary').click(); await click(page, 'View #6 Player A6'); await location(page);
  await expect(page.getByRole('button', { name: 'Made · +2 points', exact: true })).toBeDisabled();
  await expect(page.locator('.shot-selection')).toContainText('Bench player');
  await click(page, 'Select #1 Player A1'); await location(page);
  const desk = await context.newPage(); await desk.goto('/');
  for (let i = 0; i < 5; i++) await desk.getByRole('button', { name: 'Add foul for #1 Player A1', exact: true }).click();
  await expect(page.locator('.shot-selection')).toContainText('fouled out'); await expect(page.getByRole('button', { name: 'Made · +2 points', exact: true })).toBeDisabled();
  expect((await read(page)).shots).toHaveLength(0);
});

test('resetting another tab clears pending location and starts a distinct shot history', async ({ page, context }) => {
  await seed(page); await location(page); await expect(page.getByRole('button', { name: 'Made · +2 points', exact: true })).toBeEnabled();
  const desk = await context.newPage(); await desk.goto('/'); await desk.getByText('Game settings & reset', { exact: true }).click();
  desk.once('dialog', dialog => dialog.accept()); await click(desk, 'Reset game (keep rosters)');
  await expect(page.locator('.shot-marker.pending')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Made · +2 points', exact: true })).toBeDisabled();
  await location(page); await click(page, 'Made · +2 points'); const state = await read(page);
  expect(state.gameId).not.toBe('test-game'); expect(state.shots).toHaveLength(1); expect(state.teams.A.score).toBe(2);
});

test('saved match charts preserve attempts and have no recording or void controls', async ({ page }) => {
  const t = initialTournament(); for (const name of ['Home', 'Away']) { saveTeam(t, null, name); savePlayer(t, t.teams.at(-1).id, null, 'Captain', 1); }
  saveMatch(t, null, { homeId: t.teams[0].id, awayId: t.teams[1].id, scheduledAt: '', court: '' });
  const g = prepareMatchGame(t, t.matches[0].id, initial()); recordShot(g, 'A', g.teams.A.players[0].id, 2, true, .5, .3, 1000); recordResult(t, t.matches[0].id, 2, 0, 1000, g);
  await seed(page, initial(), t); const before = await read(page); await page.getByLabel('Game source', { exact: true }).selectOption('match:' + t.matches[0].id);
  await expect(page.locator('.shot-marker.made')).toHaveCount(1); await expect(page.locator('.shot-archive-note')).toBeVisible(); await expect(page.locator('.shot-detected-value')).toHaveText('RECORDED VALUES');
  await expect(page.getByRole('button', { name: /^Made ·/ })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Void attempt', exact: true })).toHaveCount(0);
  expect(await read(page)).toEqual(before);
});

test('failed shot storage writes keep the saved score and log unchanged', async ({ page }) => {
  await seed(page); const before = await read(page);
  await page.evaluate(() => { const write = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === 'basketball_modular_v1') throw new Error('Quota exceeded'); return write.call(this, key, value); }; });
  await location(page); await click(page, 'Made · +2 points'); await expect(page.getByRole('alert')).toContainText('Quota'); expect(await read(page)).toEqual(before);
  await expect(page.locator('.shot-attempt-list li')).toHaveCount(0);
});

test('phone court capture fits the viewport and touch actions record one attempt', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await seed(page);
  const bounds = await page.locator('.shot-court').boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await location(page); await expect(page.getByRole('group', { name: 'Quick shot result', exact: true })).toBeVisible();
  await click(page, 'Made · +2 points'); expect((await read(page)).shots).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('team and on-floor jersey buttons can assign a marked shot without losing its location', async ({ page }) => {
  await seed(page);
  await expect(page.getByRole('group', { name: 'Choose shooter', exact: true }).getByRole('button')).toHaveCount(5);
  await expect(page.getByRole('combobox', { name: /^(Team|Player|Shot value)$/ })).toHaveCount(0);
  await location(page, .1, .65); await expect(page.locator('.shot-detected-value')).toHaveText('3-POINT SHOT');
  await click(page, 'Select team Away'); await click(page, 'Select #3 Player B3');
  await expect(page.getByRole('button', { name: 'Select #3 Player B3', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.shot-marker.pending')).toHaveCount(1); await expect(page.locator('.shot-selection')).toContainText('#3 Player B3 · 3 points');
  await click(page, 'Made · +3 points'); const state = await read(page);
  expect(state.shots[0].playerId).toBe('B2'); expect(state.shots[0].team).toBe('B'); expect(state.shots[0].value).toBe(3);
  expect(state.teams.B.score).toBe(3); expect(state.teams.B.players[2].pts).toBe(3); expect(state.teams.A.score).toBe(0);
});

test('court line and corner classifications match rendered locations at desktop and phone sizes', async ({ page }) => {
  await seed(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [x, y, points] of [[.5, .3, 2], [.5, .7, 3], [.09, .2, 2], [.08, .2, 3], [.91, .2, 2], [.92, .2, 3]]) {
      await location(page, x, y); await expect(page.locator('.shot-detected-value')).toHaveText(points + '-POINT SHOT');
      await expect(page.getByRole('button', { name: `Made · +${points} points`, exact: true })).toBeEnabled();
      await click(page, 'Missed · attempt only'); expect((await read(page)).shots.at(-1).value).toBe(points);
    }
  }
  expect((await read(page)).teams.A.score).toBe(0);
});

for (const width of [1440, 390]) {
  test(`shot confirmation toast fades without moving the court at ${width}px and refreshes for new attempts`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await page.clock.install(); await seed(page);
    const courtTop = () => page.locator('.shot-court').evaluate(el => el.getBoundingClientRect().top + window.scrollY);
    const originalTop = await courtTop();
    await location(page, .1, .65); await click(page, 'Made · +3 points');
    const toast = page.locator('.shot-message');
    await expect(toast).toContainText('Made 3-point attempt saved · score updated.');
    await expect(toast).toBeVisible(); await expect(toast).toHaveCSS('position', 'fixed');
    expect(await courtTop()).toBeCloseTo(originalTop, 1);
    const bounds = await toast.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width); expect(bounds.y).toBeLessThan(40);
    await page.clock.fastForward(3000);
    await location(page, .5, .3); await expect(toast).toBeVisible();
    await click(page, 'Missed · attempt only');
    await expect(toast).toContainText('Missed 2-point attempt saved · score unchanged.');
    await page.clock.fastForward(600); await expect(toast).toBeVisible();
    expect(await courtTop()).toBeCloseTo(originalTop, 1);
    await page.clock.fastForward(3200); await expect(toast).not.toBeVisible();
    expect(await courtTop()).toBeCloseTo(originalTop, 1);
    expect((await read(page)).shots).toHaveLength(2);
  });
}
