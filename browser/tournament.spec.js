import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { initial, stat } from '../src/engine.js';
import { initialTournament, saveTeam, savePlayer, saveMatch, prepareMatchGame } from '../src/tournament.js';
const key = 'basketball_tournament_v1';
const click = (page, name) => page.getByRole('button', { name, exact: true }).click();
const tab = (page, name) => page.getByRole('tab', { name, exact: true }).click();
function fixture() {
  const t = initialTournament();
  for (const name of ['Wolves', 'Panthers', 'Falcons']) { saveTeam(t, null, name); savePlayer(t, t.teams.at(-1).id, null, name + ' captain', '1'); }
  saveMatch(t, null, { homeId: t.teams[0].id, awayId: t.teams[1].id, scheduledAt: '', court: 'Court 1' }); return t;
}
async function seed(page, data, game = null) {
  await page.goto('/?view=tournament');
  await page.evaluate(({ key, data, game }) => { localStorage.setItem(key, JSON.stringify(data)); if (game) localStorage.setItem('basketball_modular_v1', JSON.stringify(game)); }, { key, data, game });
  await page.reload();
}

test('manage team and player directory with validation and persistence', async ({ page }) => {
  await page.goto('/?view=tournament'); await click(page, 'Add team');
  await page.getByLabel('Team name', { exact: true }).fill('<Wolves>'); await click(page, 'Save team');
  const team = page.locator('.directory-team').first(); await expect(team.getByRole('heading')).toHaveText('<Wolves>');
  await team.getByRole('button', { name: 'Add player', exact: true }).click();
  await page.getByLabel('Player name', { exact: true }).fill('Captain'); await page.getByLabel('Jersey number').fill('00'); await click(page, 'Save player');
  await team.getByRole('button', { name: 'Add player', exact: true }).click();
  await page.getByLabel('Player name', { exact: true }).fill('Duplicate'); await page.getByLabel('Jersey number').fill('00'); await click(page, 'Save player');
  await expect(page.getByRole('alert')).toContainText('unique'); await click(page, 'Cancel');
  await team.getByRole('button', { name: 'Edit player', exact: true }).click();
  await page.getByLabel('Player name', { exact: true }).fill('Captain edited'); await click(page, 'Save player');
  await expect(team).toContainText('Captain edited'); await page.reload(); await expect(team).toContainText('Captain edited');
  page.once('dialog', dialog => dialog.accept()); await team.getByRole('button', { name: 'Delete player', exact: true }).click();
  await expect(team.locator('.directory-player')).toHaveCount(0);
  page.once('dialog', dialog => dialog.accept()); await team.getByRole('button', { name: 'Delete team', exact: true }).click();
  await expect(page.locator('.directory-team')).toHaveCount(0);
});

test('copy game rosters, schedule, load, score and finalize a match into standings and snapshot', async ({ page }) => {
  await page.goto('/?view=tournament'); page.once('dialog', dialog => dialog.accept()); await click(page, 'Copy game desk teams');
  await expect(page.locator('.directory-team')).toHaveCount(2); await tab(page, 'Matches'); await click(page, 'Schedule match');
  await page.getByLabel('Court / venue (optional)').fill('Main court'); await click(page, 'Save match');
  await expect(page.locator('.match-card')).toContainText('Home'); await click(page, 'Load game desk'); await click(page, 'Load new game');
  await expect(page).toHaveURL(/\/$/); await expect(page.locator('.match-context')).toContainText('Result not yet recorded');
  await page.getByRole('button', { name: 'Add 3 points for #1 Player A1', exact: true }).click();
  await page.getByRole('button', { name: 'Add rebound for #1 Player A1', exact: true }).click();
  await page.getByRole('link', { name: 'Record result / manage matches →', exact: true }).click();
  await click(page, 'Record game desk result'); await expect(page.getByLabel('Home final score')).toHaveValue('3');
  await click(page, 'Record final result'); await expect(page.locator('.match-card')).toContainText('FINAL');
  await page.getByText('Recorded box score', { exact: true }).click();
  await expect(page.locator('.boxscore').first()).toContainText('Player A1');
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  expect(saved.matches[0].result.game.teams.A.players[0].reb).toBe(1); expect(saved.matches[0].result.homeScore).toBe(3);
  await tab(page, 'Standings'); await expect(page.locator('tbody tr').first()).toContainText('Home');
  expect(await page.locator('tbody tr').first().locator('td').allTextContents()).toEqual(['1', 'Home', '1', '1', '0', '100.0%', '3', '0', '+3']);
});

test('manual results reject ties, correct standings, and reopening removes the result', async ({ page }) => {
  await seed(page, fixture()); await tab(page, 'Matches'); await click(page, 'Enter result');
  await page.getByLabel('Home final score').fill('50'); await page.getByLabel('Away final score').fill('50'); await click(page, 'Record final result');
  await expect(page.getByRole('alert')).toContainText('winner'); await page.getByLabel('Away final score').fill('40'); await click(page, 'Record final result');
  await tab(page, 'Standings'); await expect(page.locator('tbody tr').first()).toContainText('Wolves');
  await tab(page, 'Matches'); await click(page, 'Correct result'); await page.getByLabel('Away final score').fill('60'); await click(page, 'Update final result');
  await tab(page, 'Standings'); await expect(page.locator('tbody tr').first()).toContainText('Panthers');
  await tab(page, 'Matches'); page.once('dialog', dialog => dialog.accept()); await click(page, 'Reopen match');
  await tab(page, 'Standings'); for (const row of await page.locator('tbody tr').all()) await expect(row.locator('td').nth(2)).toHaveText('0');
});

test('unfinished linked games block replacement and directory edits do not clear foul-outs', async ({ page }) => {
  const t = fixture(), current = prepareMatchGame(t, t.matches[0].id, initial());
  for (let i = 0; i < 5; i++) stat(current, 'A', current.teams.A.players[0].id, 'fls');
  saveMatch(t, null, { homeId: t.teams[0].id, awayId: t.teams[2].id, scheduledAt: '', court: '' });
  await seed(page, t, current);
  await page.locator('.directory-team').first().getByRole('button', { name: 'Edit player', exact: true }).click();
  await page.getByLabel('Player name').fill('Renamed captain'); await click(page, 'Save player');
  await tab(page, 'Matches'); await page.locator('.match-card').nth(1).getByRole('button', { name: 'Load game desk', exact: true }).click();
  await click(page, 'Load new game'); await expect(page.getByRole('alert')).toContainText('already');
  const unchanged = await page.evaluate(() => JSON.parse(localStorage.getItem('basketball_modular_v1')));
  expect(unchanged.teams.A.players[0].out).toBe(true); expect(unchanged.teams.A.players[0].name).toBe('Wolves captain');
});

test('tournament export/import validates, previews, confirms and restores directory and schedule', async ({ page }) => {
  const t = fixture(); await seed(page, t);
  const promise = page.waitForEvent('download'); await click(page, 'Export tournament'); const download = await promise;
  const json = await readFile(await download.path(), 'utf8'); expect(JSON.parse(json).tournament.matches).toHaveLength(1);
  await click(page, 'Import tournament'); const file = page.getByLabel('Tournament JSON backup');
  await file.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Unsupported');
  await click(page, 'Replace tournament'); await expect(page.getByRole('alert')).toContainText('valid');
  await file.setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('3 teams · 1 matches');
  page.once('dialog', dialog => dialog.accept()); await click(page, 'Replace tournament');
  await expect(page.getByRole('dialog')).not.toBeVisible(); expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual(t);
});

test('stale manual result forms reject a match loaded into the desk in another tab', async ({ page, context }) => {
  const t = fixture(); await seed(page, t); await tab(page, 'Matches'); await click(page, 'Enter result');
  const other = await context.newPage(); await other.goto('/');
  const current = prepareMatchGame(t, t.matches[0].id, initial());
  await other.evaluate(current => localStorage.setItem('basketball_modular_v1', JSON.stringify(current)), current);
  await page.getByLabel('Home final score').fill('10'); await page.getByLabel('Away final score').fill('5'); await click(page, 'Record final result');
  await expect(page.getByRole('alert')).toContainText('now on the game desk');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).matches[0].status, key)).toBe('scheduled');
});

test('tournament quota errors keep the previous directory and report the failure', async ({ page }) => {
  const t = fixture(); await seed(page, t);
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'basketball_tournament_v1') throw new Error('Quota exceeded'); return set.call(this, key, value); };
  });
  await click(page, 'Add team'); await page.getByLabel('Team name', { exact: true }).fill('New team'); await click(page, 'Save team');
  await expect(page.getByRole('alert')).toContainText('Quota');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual(t);
  await expect(page.locator('.directory-team')).toHaveCount(3);
});
