import { test, expect } from '@playwright/test';
import { signIn, overflowsSideways } from './helpers';

// Backups: the "Backup period" dropdown (lifetime / this month / custom range) decides what every download and count covers.
const now = new Date();
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

test('Owner: chooses lifetime, this month or a custom range, and every download follows it', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, 'owner');
  await page.goto('/backups');
  await expect(page.getByRole('heading', { name: 'Backups & Data Export' })).toBeVisible();

  const period = page.getByLabel('Backup period');
  const zip = page.getByRole('link', { name: /Excel ZIP/ });
  const firstExcel = page.getByRole('link', { name: 'Excel', exact: true }).first();

  // the three choices, lifetime first; with no choice the links carry no period (what they always did)
  await expect(period.locator('option')).toHaveText(['Lifetime backup (all data)', 'This month backup (current month)', 'Custom range (selected dates)']);
  await expect(page.getByText('Every download below holds all the data.')).toBeVisible();
  await expect(zip).toHaveAttribute('href', '/api/backups/download-all?format=xlsx');

  // this month: the links, the counts and the sentence all follow
  await period.selectOption('month');
  await expect(zip).toHaveAttribute('href', '/api/backups/download-all?format=xlsx&range=month');
  await expect(firstExcel).toHaveAttribute('href', /&range=month$/);
  await expect(page.getByText(new RegExp(`Records dated ${ym}-01 to ${ym}-\\d\\d`))).toBeVisible();
  await expect(page.getByText(/Lists without dates .* are always included in full/)).toBeVisible();

  // custom range: two dates appear; a reversed range is refused and the downloads switch off
  await period.selectOption('custom');
  await page.locator('#bk_from').fill('2026-05-10');
  await page.locator('#bk_to').fill('2026-05-01');
  await expect(page.getByRole('alert').filter({ hasText: 'the first date must not be after the last' })).toBeVisible();
  await expect(zip).toHaveAttribute('aria-disabled', 'true');
  await expect(firstExcel).toHaveAttribute('aria-disabled', 'true');
  // a good range switches them on again, with both dates in the link
  await page.locator('#bk_to').fill('2026-05-31');
  await expect(zip).not.toHaveAttribute('aria-disabled', 'true');
  await expect(zip).toHaveAttribute('href', '/api/backups/download-all?format=xlsx&range=custom&from=2026-05-10&to=2026-05-31');

  // and the file really comes, named after the range
  const [download] = await Promise.all([page.waitForEvent('download'), firstExcel.click()]);
  expect(download.suggestedFilename()).toMatch(/-backup-2026-05-10_to_2026-05-31\.xlsx$/);

  expect(await overflowsSideways(page)).toBe(false);
});

test('Owner: the reminder link opens Backups already on "This month"', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, 'owner');
  await page.goto('/backups?range=month');
  await expect(page.getByLabel('Backup period')).toHaveValue('month');
  await expect(page.getByRole('link', { name: /Excel ZIP/ })).toHaveAttribute('href', /range=month/);
});

test('a worker cannot open Backups', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, 'worker');
  const res = await page.request.get('/api/backups/sections?range=month');
  expect(res.status()).toBe(403);
});
