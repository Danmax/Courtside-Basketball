import { test, expect } from '@playwright/test';
import { initial } from '../src/engine.js';
import { initialTournament, saveTeam, savePlayer, saveMatch, prepareMatchGame, recordResult } from '../src/tournament.js';
const gameKey = 'basketball_modular_v1', tournamentKey = 'basketball_tournament_v1';
async function seed(page, game, tournament = null, url = '/?view=players') {
  await page.goto(url);
  await page.evaluate(({ game, tournament, gameKey, tournamentKey }) => { if (game) localStorage.setItem(gameKey, JSON.stringify(game)); if (tournament) localStorage.setItem(tournamentKey, JSON.stringify(tournament)); }, { game, tournament, gameKey, tournamentKey });
  await page.reload();
}
function fixture() {
  const t = initialTournament();
  for (const name of ['Wolves', 'Panthers']) { saveTeam(t, null, name); savePlayer(t, t.teams.at(-1).id, null, name + ' captain', '1'); savePlayer(t, t.teams.at(-1).id, null, 'Unused bench', '2'); }
  let game;
  for (const [i, home, away] of [[0, 10, 2], [1, 3, 5]]) {
    saveMatch(t, null, { homeId: t.teams[i ? 1 : 0].id, awayId: t.teams[i ? 0 : 1].id, scheduledAt: '', court: '' });
    game = prepareMatchGame(t, t.matches.at(-1).id, initial());
    for (const team of Object.values(game.teams)) team.players[1].on = false;
    game.teams.A.score = home; game.teams.B.score = away;
    game.teams.A.players[0].pts = home; game.teams.B.players[0].pts = away;
    const wolves = game.teams[i ? 'B' : 'A'].players[0]; wolves.reb = i ? 0 : 10; wolves.ast = i ? 0 : 10; wolves.ms = 60000;
    recordResult(t, t.matches.at(-1).id, home, away, (i + 1) * 1000, game);
  }
  saveMatch(t, null, { homeId: t.teams[0].id, awayId: t.teams[1].id, scheduledAt: '', court: '' }); recordResult(t, t.matches.at(-1).id, 100, 50, 3000);
  return { t, game };
}

test('current player page filters on-court/team/search and shows grounded milestones without writes', async ({ page }) => {
  const game = initial(); Object.assign(game.teams.A.players[0], { name: '<Alex>', pts: 21, reb: 10, ast: 10, ms: 60000 }); game.teams.A.score = 21;
  await seed(page, game);
  const saved = await page.evaluate(key => localStorage.getItem(key), gameKey);
  await expect(page.locator('.player-stat-table tbody tr')).toHaveCount(14);
  await expect(page.locator('.player-feature h2')).toHaveText('<Alex>');
  await expect(page.locator('.player-milestones [data-fact=triple] strong')).toHaveText('1');
  await page.getByLabel('On floor only', { exact: true }).check(); await expect(page.locator('.player-stat-table tbody tr')).toHaveCount(10);
  await page.getByLabel('Team', { exact: true }).selectOption('A'); await expect(page.locator('.player-stat-table tbody tr')).toHaveCount(5);
  await page.getByLabel('Find a player', { exact: true }).fill('Alex'); await expect(page.locator('.player-stat-table tbody tr')).toHaveCount(1);
  await expect(page.getByLabel('Find a player', { exact: true })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const label of ['PTS', 'REB', 'AST', 'MIN']) {
    const cell = page.locator('.player-stat-table tbody td[data-label="' + label + '"]');
    const rect = await cell.boundingBox(); expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(390);
  }
  expect(await page.evaluate(key => localStorage.getItem(key), gameKey)).toBe(saved);
  await expect(page.getByRole('button', { name: /Start game|Add rebound|Edit player/ })).toHaveCount(0);
});

test('tournament stats cover saved finals, correct averages, selected logs and archived sources', async ({ page }) => {
  const { t, game } = fixture(); await seed(page, game, t);
  await page.getByLabel('Stats source', { exact: true }).selectOption('tournament');
  await expect(page.locator('.stats-scope')).toContainText('2 of 3 final matches');
  await page.getByLabel('Team', { exact: true }).selectOption(t.teams[0].id);
  await expect(page.locator('.player-feature h2')).toHaveText('Wolves captain');
  await expect(page.locator('.spotlight-numbers strong').first()).toHaveText('15');
  await expect(page.locator('.player-game-log tbody tr')).toHaveCount(2);
  await page.getByLabel('Display values', { exact: true }).selectOption('average');
  await expect(page.locator('.spotlight-numbers strong').first()).toHaveText('7.5');
  const bench = page.locator('.player-stat-table tbody tr').filter({ hasText: 'Unused bench' });
  await expect(bench.locator('td').nth(2)).toHaveText('—');
  await expect(page.locator('.player-milestones [data-fact=triple] strong')).toHaveText('1');
  await page.getByLabel('Stats source', { exact: true }).selectOption('match:' + t.matches[0].id);
  await expect(page.locator('.stats-scope')).toContainText('Final box score');
  await expect(page.locator('.spotlight-numbers strong').first()).toHaveText('10');
  await expect(page.locator('.game-facts-panel')).toContainText('Final winning margin');
});

test('read-only player stats project playing time while stored clock state stays unchanged', async ({ page }) => {
  const game = initial(); game.stamp = Date.now(); game.running = game.shotRunning = true;
  await seed(page, game);
  const raw = await page.evaluate(key => localStorage.getItem(key), gameKey);
  await expect.poll(async () => page.locator('.player-stat-table tbody tr').first().locator('td').last().textContent()).not.toBe('0:00');
  expect(await page.evaluate(key => localStorage.getItem(key), gameKey)).toBe(raw);
});

test('presentation view fits 1080p, has no editing controls and preserves saved data', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const game = initial(); game.teams.A.players[0].pts = 24; game.teams.A.players[0].reb = 10; game.teams.A.score = 24;
  await seed(page, game, null, '/?view=players&display=1');
  await expect(page.locator('.boxscore tbody tr')).toHaveCount(10);
  await expect(page.getByRole('button')).toHaveCount(0); await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.locator('.presentation-facts [data-fact=scorer]')).toContainText('24 PTS');
  for (const selector of ['.boxscore-grid', '.presentation-facts']) { const rect = await page.locator(selector).boundingBox(); expect(rect.y).toBeGreaterThanOrEqual(0); expect(rect.y + rect.height).toBeLessThanOrEqual(1080); }
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), gameKey)).toEqual(game);
});

test('archived source becomes explicitly unavailable when its result is reopened in another tab', async ({ page, context }) => {
  const { t, game } = fixture(); await seed(page, game, t, '/?view=players&source=match:' + t.matches[0].id);
  await expect(page.locator('.stats-scope')).toContainText('Final box score');
  const other = await context.newPage(); await other.goto('/?view=tournament');
  t.matches[0].status = 'scheduled'; t.matches[0].result = null;
  await other.evaluate(({ key, t }) => localStorage.setItem(key, JSON.stringify(t)), { key: tournamentKey, t });
  await expect(page.getByRole('alert')).toContainText('no longer has a saved player box score');
  await expect(page.locator('.player-stat-table')).toHaveCount(0);
});

test('empty tournament and corrupt current data give honest read-only empty/error states on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/?view=players&source=tournament');
  await expect(page.locator('.game-facts-panel')).toContainText('Finalize a match');
  await expect(page.locator('.player-stat-table tbody tr')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.evaluate(key => localStorage.setItem(key, '{broken'), gameKey);
  await page.getByLabel('Stats source', { exact: true }).selectOption('current');
  await expect(page.getByRole('alert')).toContainText('cannot be read');
  expect(await page.evaluate(key => localStorage.getItem(key), gameKey)).toBe('{broken');
});
