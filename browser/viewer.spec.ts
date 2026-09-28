import { expect, test } from '@playwright/test';

/** Serve a deterministic uncompressed Zarr v2 store through the real data worker. */
function fixtureStore(kind: 'forecast' | 'stac' | 'snowfall' = 'forecast') {
  const stac = kind === 'stac';
  const snowfall = kind === 'snowfall';
  const lon = stac ? 'east' : 'longitude';
  const lat = stac ? 'north' : 'latitude';
  const time = stac ? 'date' : snowfall ? 'winter' : 'time';
  const files = new Map<string, string | Buffer>();
  const metadata: Record<string, unknown> = {};
  const array = (
    name: string,
    shape: number[],
    dimensions: string[],
    values: number[],
    units: string,
  ) => {
    const definition = {
      zarr_format: 2,
      shape,
      chunks: shape,
      dtype: '<f4',
      compressor: null,
      fill_value: null,
      order: 'C',
      filters: null,
    };
    const attrs = { _ARRAY_DIMENSIONS: dimensions, units };
    files.set(`${name}/.zarray`, JSON.stringify(definition));
    files.set(`${name}/.zattrs`, JSON.stringify(attrs));
    files.set(
      `${name}/${shape.map(() => 0).join('.')}`,
      Buffer.from(new Float32Array(values).buffer),
    );
    metadata[`${name}/.zarray`] = definition;
    metadata[`${name}/.zattrs`] = attrs;
  };
  array(lon, [3], [lon], [0, 1, 2], 'degrees_east');
  array(lat, [3], [lat], [40, 41, 42], 'degrees_north');
  array(time, [3], [time], snowfall ? [2022, 2023, 2024] : [0, 6, 12], snowfall ? '' : 'hours');
  array(
    snowfall ? 'winter_anomaly' : 'temperature_2m',
    [3, 3, 3],
    [time, lat, lon],
    Array.from({ length: 27 }, (_, i) => i),
    snowfall ? 'mm' : 'degree_Celsius',
  );
  files.set('.zmetadata', JSON.stringify({ zarr_consolidated_format: 1, metadata }));
  files.set('.zgroup', JSON.stringify({ zarr_format: 2 }));
  return files;
}

test('loads a volume, renders palettes, and applies SQL through the real workers', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => localStorage.setItem('zarr-sql-views-tour-v1', 'seen'));
  const files = fixtureStore();
  await context.route('**/fixture.zarr/**', async (route) => {
    const path = new URL(route.request().url()).pathname.split('/fixture.zarr/')[1];
    const data = files.get(path);
    await route.fulfill({
      status: data === undefined ? 404 : 200,
      body: data ?? '',
      contentType: typeof data === 'string' ? 'application/json' : 'application/octet-stream',
    });
  });
  const params = new URLSearchParams({
    dataset: 'http://127.0.0.1:4175/fixture.zarr',
    variable: 'temperature_2m',
    extent: '[0,40,2,42]',
  });
  await page.goto(`/?${params}`);
  await expect(page.getByLabel('Interactive forecast cube')).toBeVisible();
  await expect(page.locator('.cube-host canvas, canvas').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run query', exact: true })).toBeEnabled();
  await page.getByLabel('SQL query').fill('SELECT cell_id FROM loaded_forecast WHERE value > 10');
  await page.getByRole('button', { name: 'Run query', exact: true }).click();
  await expect(page.locator('.selection-status')).toHaveText('16 cells');
  await page.getByRole('slider', { name: 'Forecast playback' }).press('ArrowLeft');
  await expect(page.getByRole('button', { name: 'Reveal all matches' })).toBeVisible();
  await page.getByRole('button', { name: 'Reveal all matches' }).click();
  await expect(page.getByRole('button', { name: 'Reveal all matches' })).toHaveCount(0);
  await expect(page.locator('.selection-status')).toHaveText('16 cells');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.locator('.selection-status')).toHaveCount(0);
  await page.getByLabel('Color settings').click();
  const palette = page.getByLabel('Color palette', { exact: true });
  await palette.selectOption('ocean');
  await expect(palette).toHaveValue('ocean');
  await palette.selectOption('ember');
  await expect(palette).toHaveValue('ember');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/viewer.png' });
  for (let i = 0; i < 20; i++)
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.screenshot({ path: 'test-results/viewer-close-zoom.png' });
  await page.getByRole('button', { name: 'Reset camera', exact: true }).click();
  expect(errors.filter((message) => !message.includes('404'))).toEqual([]);
});

test('loads nonstandard dimension names from STAC through the real Zarr worker', async ({
  page,
  context,
}) => {
  const files = fixtureStore('stac');
  await page.addInitScript(() => localStorage.setItem('zarr-sql-views-tour-v1', 'seen'));
  await context.route('**/fixture.zarr/**', async (route) => {
    const data = files.get(new URL(route.request().url()).pathname.split('/fixture.zarr/')[1]);
    await route.fulfill({
      status: data === undefined ? 404 : 200,
      body: data ?? '',
      contentType: typeof data === 'string' ? 'application/json' : 'application/octet-stream',
    });
  });
  await context.route('**/collection.json', async (route) => {
    await route.fulfill({
      json: {
        type: 'Collection',
        title: 'STAC snowfall fixture',
        'cube:dimensions': {
          east: { type: 'spatial', axis: 'x' },
          north: { type: 'spatial', axis: 'y' },
          date: { type: 'temporal' },
        },
        'cube:variables': {
          temperature_2m: { type: 'data', dimensions: ['date', 'north', 'east'] },
        },
        assets: { data: { href: './fixture.zarr', type: 'application/vnd+zarr' } },
      },
    });
  });
  const params = new URLSearchParams({
    dataset: 'http://127.0.0.1:4175/collection.json',
    variable: 'temperature_2m',
    extent: '[0,40,2,42]',
  });
  await page.goto(`/?${params}`);
  await expect(page.getByLabel('Interactive forecast cube')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run query', exact: true })).toBeEnabled();
  await page.getByLabel('SQL query').fill('SELECT cell_id FROM loaded_forecast WHERE value > 10');
  await page.getByRole('button', { name: 'Run query', exact: true }).click();
  await expect(page.locator('.selection-status')).toHaveText('16 cells');
});

test('keeps an out-of-bounds pan in place and allows panning back into coverage', async ({
  page,
  context,
}) => {
  const files = fixtureStore();
  await page.addInitScript(() => localStorage.setItem('zarr-sql-views-tour-v1', 'seen'));
  await context.route('**/fixture.zarr/**', async (route) => {
    const data = files.get(new URL(route.request().url()).pathname.split('/fixture.zarr/')[1]);
    await route.fulfill({
      status: data === undefined ? 404 : 200,
      body: data ?? '',
      contentType: typeof data === 'string' ? 'application/json' : 'application/octet-stream',
    });
  });
  const params = new URLSearchParams({
    dataset: 'http://127.0.0.1:4175/fixture.zarr',
    variable: 'temperature_2m',
    extent: '[0,40,2,42]',
  });
  await page.goto(`/?${params}`);
  const cube = page.getByLabel('Interactive forecast cube');
  await expect(page.getByRole('button', { name: 'Run query', exact: true })).toBeEnabled();
  const original = page.url();
  const minimap = page.locator('.world-minimap-region').first();
  const originalX = await minimap.getAttribute('x');
  const box = (await cube.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const pan = async (dx: number) => {
    await page.keyboard.down('Meta');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Meta');
  };
  await pan(1800);
  await expect(page.locator('.canvas-region-status')).toHaveText('No data in this area.');
  await expect(page.locator('.render-error')).toHaveCount(0);
  expect(page.url()).toBe(original);
  await expect(cube).not.toHaveClass(/region-grabbing/);
  await expect(minimap).not.toHaveAttribute('x', originalX!);
  const outsideX = await minimap.getAttribute('x');
  await expect(page.locator('.canvas-region-status')).toHaveCount(0, { timeout: 7000 });
  await expect(minimap).toHaveAttribute('x', outsideX!);
  await pan(10);
  await expect(minimap).not.toHaveAttribute('x', outsideX!);
  await expect(page.locator('.canvas-region-status')).toHaveText('No data in this area.');
  await pan(-1810);
  await expect(page.locator('.canvas-region-status')).toHaveCount(0, { timeout: 7000 });
  expect(Number(await minimap.getAttribute('x'))).toBeCloseTo(Number(originalX), 3);
  await page.getByLabel('SQL query').fill('SELECT cell_id FROM loaded_forecast WHERE value > 10');
  await page.getByRole('button', { name: 'Run query', exact: true }).click();
  await expect(page.locator('.selection-status')).toHaveText(/^[1-9][0-9]* cells$/);
  await expect(page.locator('.render-error')).toHaveCount(0);
});

test('opens a snowfall URL without a variable and preserves calendar years in SQL', async ({
  page,
  context,
}) => {
  const files = fixtureStore('snowfall');
  await page.addInitScript(() => localStorage.setItem('zarr-sql-views-tour-v1', 'seen'));
  await context.route('https://data.source.coop/alukach/el-nino-snowfall/**', async (route) => {
    const data = files.get(new URL(route.request().url()).pathname.split('/el-nino-snowfall/')[1]);
    await route.fulfill({
      status: data === undefined ? 404 : 200,
      body: data ?? '',
      contentType: typeof data === 'string' ? 'application/json' : 'application/octet-stream',
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  });
  const params = new URLSearchParams({
    dataset: 'https://data.source.coop/alukach/el-nino-snowfall',
    extent: '[0,40,2,42]',
  });
  await page.goto(`/?${params}`);
  await expect(page.getByRole('button', { name: 'Run query', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Variable', { exact: true })).toHaveValue('winter_anomaly');
  await expect(page.locator('.lead-label')).toHaveText('Winter 2024');
  await page
    .getByLabel('SQL query')
    .fill('SELECT cell_id FROM loaded_forecast WHERE winter = 2024');
  await page.getByRole('button', { name: 'Run query', exact: true }).click();
  await expect(page.locator('.selection-status')).toHaveText('9 cells');
});
