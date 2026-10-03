import { loadEnv } from 'vite';
const snowfallUrl =
  process.env.VITE_SOURCE_COOP_URL ??
  loadEnv('development', process.cwd(), 'VITE_').VITE_SOURCE_COOP_URL;
import { expect, test } from '@playwright/test';

/** Opt-in live integration: validates Source Cooperative CORS, Zstd decoding and real years. */
test('opens the public snowfall example from Browse datasets', async ({ page }) => {
  test.skip(
    !process.env.SNOWFALL_LIVE || !snowfallUrl,
    'Set SNOWFALL_LIVE=1 to access the public store.',
  );
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('zarr-sql-views-tour-v1', 'seen'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Browse datasets', exact: true }).click();
  await page.getByRole('button', { name: 'El Niño snowfall', exact: true }).click();
  await expect(page.getByLabel('Interactive forecast cube')).toBeVisible({ timeout: 90000 });
  await expect(page.locator('.lead-label')).toHaveText('Winter 2024');
  expect(JSON.parse(new URL(page.url()).searchParams.get('extent')!)).toEqual([-170, 10, -50, 85]);
  expect(JSON.parse(new URL(page.url()).searchParams.get('slices')!)).toEqual([480, 0, 65]);
  await page.getByLabel('Color settings').click();
  await expect(page.getByLabel('Color palette', { exact: true })).toHaveValue('snowfall');
  await expect(page.getByLabel('Color minimum')).toHaveValue('-100');
  await expect(page.getByLabel('Color maximum')).toHaveValue('100');
  await page.keyboard.press('Escape');
  await expect(page.locator('.analysis-window-note')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run query', exact: true })).toBeEnabled();
  await page
    .getByLabel('SQL query')
    .fill('SELECT cell_id FROM loaded_forecast WHERE winter = 2024 AND value < 0');
  await page.getByRole('button', { name: 'Run query', exact: true }).click();
  await expect(page.locator('.selection-status')).toHaveText(/[1-9][\d,]* cells/, {
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.screenshot({ path: 'test-results/snowfall-live.png' });
  const variables = page.getByLabel('Variable', { exact: true });
  await expect(variables.locator('option')).toHaveCount(6);
  await expect(variables.locator('option[value="winter_anomaly"]')).toHaveText(
    'Detrended JFM snowfall anomaly vs 1991-2020, every winter',
  );
  await expect(variables.locator('option[value="event_anomaly"]')).toHaveText(
    'Detrended JFM snowfall anomaly vs 1991-2020 per event',
  );
  await expect(variables.locator('option[value="jfm_snowfall"]')).toHaveText(
    'JFM snowfall total (not detrended), every winter',
  );
  for (const name of ['anomaly', 'below_count', 'roni_djf'])
    await expect(variables.locator(`option[value="${name}"]`)).toBeDisabled();
  await variables.selectOption('event_anomaly');
  await expect(page.getByRole('button', { name: 'Run query', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  await page.getByRole('slider', { name: 'Winter playback' }).press('ArrowLeft');
  await expect(page.locator('.lead-label')).toHaveText('Winter 2016');
  await variables.selectOption('jfm_snowfall');
  await expect(page.getByRole('button', { name: 'Run query', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  await expect(page.locator('.lead-label')).toHaveText('Winter 2024');
  await page.getByLabel('Color settings').click();
  await expect(page.getByLabel('Color palette', { exact: true })).toHaveValue('thermal');
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('keeps 2024 SQL matches when the visible winter cut is 1995', async ({ page }) => {
  test.skip(
    !process.env.SNOWFALL_LIVE || !snowfallUrl,
    'Set SNOWFALL_LIVE=1 to access the public store.',
  );
  test.setTimeout(120000);
  await page.addInitScript(() => localStorage.setItem('zarr-sql-views-tour-v1', 'seen'));
  const params = new URLSearchParams({
    dataset: snowfallUrl,
    variable: 'winter_anomaly',
    extent: '[-132.2128,22.7492,-97.2128,57.7492]',
  });
  await page.goto(`/?${params}`);
  await expect(page.getByRole('button', { name: 'Run query', exact: true })).toBeEnabled({
    timeout: 90000,
  });
  for (let i = 0; i < 29; i++)
    await page.getByRole('slider', { name: 'Winter playback' }).press('ArrowLeft');
  await expect(page.locator('.lead-label')).toHaveText('Winter 1995');
  await page
    .getByLabel('SQL query')
    .fill('SELECT cell_id FROM loaded_forecast WHERE winter = 2024 AND value < 0');
  await page.getByRole('button', { name: 'Run query', exact: true }).click();
  await expect(page.locator('.selection-status')).toHaveText('5,142 cells', { timeout: 30000 });
  await expect(page.getByText('SQL matches extend beyond the current slices.')).toBeVisible();
  await page.getByRole('button', { name: 'Reveal all matches' }).click();
  await expect(page.locator('.lead-label')).toHaveText('Winter 2024');
  await expect(page.getByRole('button', { name: 'Reveal all matches' })).toHaveCount(0);
  await expect(page.locator('.selection-status')).toHaveText('5,142 cells');
  await page.screenshot({ path: 'test-results/snowfall-revealed.png' });
});

test('preserves the full cube footprint at the snowfall coverage edge and back', async ({
  page,
}) => {
  test.skip(
    !process.env.SNOWFALL_LIVE || !snowfallUrl,
    'Set SNOWFALL_LIVE=1 to access the public store.',
  );
  test.setTimeout(120000);
  await page.addInitScript(() => localStorage.setItem('zarr-sql-views-tour-v1', 'seen'));
  const params = new URLSearchParams({
    dataset: snowfallUrl,
    variable: 'winter_anomaly',
    extent: '[-55,25,-20,60]',
  });
  await page.goto(`/?${params}`);
  const cube = page.getByLabel('Interactive forecast cube');
  await expect(page.getByRole('button', { name: 'Run query', exact: true })).toBeEnabled({
    timeout: 90000,
  });
  expect(JSON.parse(new URL(page.url()).searchParams.get('slices')!)).toEqual([140, 0, 65]);
  await page.screenshot({ path: 'test-results/snowfall-coverage-edge.png' });
  const box = (await cube.boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  const pan = async (dx: number) => {
    await page.keyboard.down('Meta');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Meta');
  };
  await pan(-600);
  await expect(page.locator('.canvas-region-status')).toHaveText('No data in this area.', {
    timeout: 10000,
  });
  await page.screenshot({ path: 'test-results/snowfall-outside-coverage.png' });
  await pan(1000);
  await expect(page.locator('.canvas-region-status')).toHaveCount(0, { timeout: 30000 });
  const returned = new URL(page.url());
  const extent = JSON.parse(returned.searchParams.get('extent')!);
  expect((extent[2] - extent[0] + 360) % 360).toBeCloseTo(35, 3);
  const cuts = JSON.parse(returned.searchParams.get('slices')!);
  expect(cuts[0]).toBeGreaterThanOrEqual(139);
  expect(cuts[1]).toBe(0);
  expect(cuts[2]).toBe(65);
  await expect(page.locator('.render-error')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/snowfall-returned-coverage.png' });
});
