import { test, expect } from '@playwright/test';
test('organizer manages teams, coaches and players with persistent shared directory', async ({ page }) => {
  await page.goto('/?view=organizer');
  await expect(page.getByRole('heading', {name:'Host Organizer',exact:true})).toBeVisible();
  await page.getByRole('button', {name:'Add team',exact:true}).click();
  await page.getByLabel('Team name',{exact:true}).fill('Falcons'); await page.getByRole('button',{name:'Save team',exact:true}).click();
  await page.getByRole('tab',{name:'Coaches',exact:true}).click(); await page.getByRole('button',{name:'Add coach',exact:true}).click();
  await page.getByLabel('Coach name',{exact:true}).fill('Alex Rivera'); await page.getByRole('button',{name:'Save coach',exact:true}).click();
  await expect(page.locator('.directory-player')).toContainText('Alex Rivera');
  await page.getByRole('button',{name:'Edit coach',exact:true}).click(); await page.getByLabel('Staff role').selectOption('Assistant coach');
  await page.getByRole('button',{name:'Save coach',exact:true}).click(); await page.reload();
  await expect(page.locator('.directory-player')).toContainText('Assistant coach');
  await page.getByRole('tab',{name:'Players',exact:true}).click(); await page.getByRole('button',{name:'Add player',exact:true}).click();
  await page.getByLabel('Player name',{exact:true}).fill('Jordan Lee'); await page.getByLabel('Jersey number',{exact:true}).fill('23');
  await page.getByRole('button',{name:'Save player',exact:true}).click(); await expect(page.locator('.directory-player')).toContainText('Jordan Lee');
  await page.getByLabel('Search name').fill('missing'); await expect(page.locator('.directory-player')).toHaveCount(0);
  await page.goto('/?view=tournament'); await expect(page.locator('.directory-player')).toContainText('Jordan Lee');
  await page.goto('/?view=organizer#coaches'); page.once('dialog', dialog => dialog.accept()); await page.getByRole('button',{name:'Remove coach',exact:true}).click();
  await expect(page.locator('.directory-player')).toHaveCount(0);
});

test('profile photo and team logo upload, preview, persist and remove on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/?view=organizer');
  const image = { name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64') };
  // Generate a valid browser-encoded image, independent of PNG decoder tolerance.
  image.buffer = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 8; const ctx = c.getContext('2d'); ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 8, 8); return c.toDataURL('image/png').split(',')[1]; }), 'base64');
  await page.getByRole('button', {name:'Add team',exact:true}).click(); await page.getByLabel('Team name', {exact:true}).fill('Falcons');
  await page.getByLabel('Team logo', {exact:true}).setInputFiles(image); await expect(page.getByRole('status').filter({hasText:'Image ready'})).toBeVisible();
  await page.getByRole('button',{name:'Save team',exact:true}).click(); await expect(page.getByAltText('Falcons logo',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Players',exact:true}).click(); await page.getByRole('button',{name:'Add player',exact:true}).click();
  await page.getByLabel('Player name',{exact:true}).fill('Jordan Lee'); await page.getByLabel('Jersey number',{exact:true}).fill('23');
  await page.getByLabel('Position',{exact:true}).selectOption('Point guard'); await page.getByLabel('Height (optional)',{exact:true}).fill(`6'2"`);
  await page.getByLabel('Hometown',{exact:true}).fill('San Juan'); await page.getByLabel('Biography',{exact:true}).fill('Team captain');
  await page.getByLabel('Player photo',{exact:true}).setInputFiles(image); await expect(page.getByRole('status').filter({hasText:'Image ready'})).toBeVisible();
  await page.getByRole('button',{name:'Save player',exact:true}).click(); await page.reload();
  await expect(page.locator('.directory-player img')).toBeVisible(); await page.getByText('Jordan Lee · Profile',{exact:true}).click();
  await expect(page.locator('.directory-profile')).toContainText(`Point guard · 6'2" (188 cm) · San Juan`); await expect(page.locator('.directory-profile')).toContainText('Team captain');
  await page.getByRole('button',{name:'Edit player',exact:true}).click();
  await expect(page.getByLabel('Height (optional)',{exact:true})).toHaveValue(`6'2"`);
  await expect(page.getByLabel('Position',{exact:true})).toHaveValue('Point guard');
  await page.getByLabel('Player photo',{exact:true}).setInputFiles({name:'invalid.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});
  await page.getByRole('button',{name:'Save player',exact:true}).click(); await expect(page.getByRole('alert')).toContainText('Choose a PNG');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('basketball_tournament_v1')).teams[0].players[0].profile.photo)).toMatch(/^data:image\/webp/);
  await page.getByRole('button',{name:'Remove image',exact:true}).click(); await page.getByRole('button',{name:'Save player',exact:true}).click();
  await expect(page.locator('.directory-player img')).toHaveCount(0);
  await page.getByRole('tab',{name:'Teams',exact:true}).click(); await page.getByRole('button',{name:'Edit team',exact:true}).click();
  await page.getByRole('button',{name:'Remove image',exact:true}).click(); await page.getByRole('button',{name:'Save team',exact:true}).click(); await expect(page.getByAltText('Falcons logo',{exact:true})).toHaveCount(0);
});
