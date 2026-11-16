import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

// Speed: the first data requests of a screen are sent from the HTML on the next full load (not after the JavaScript has started),
// a list seen before is shown at once, the sidebar does not prefetch every screen, and a list draws the table OR the cards.
test.use({ viewport: { width: 1280, height: 800 } });

test('Owner: a screen remembers its first requests and the next load sends them early, once', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, 'owner');
  await page.goto('/employees');
  await expect(page.locator('tr', { hasText: 'E2E worker' })).toBeVisible();
  const remembered: string[] = await page.evaluate(() => JSON.parse(localStorage.getItem('vss_pre:/employees') || '[]'));
  expect(remembered.length).toBeGreaterThan(0);
  expect(remembered.every((u) => u.startsWith('/api/'))).toBe(true);
  const listUrl = remembered.find((u) => u.startsWith('/api/employees?'))!;
  expect(listUrl).toBeTruthy();

  // the next full load: each remembered request goes out exactly once (the app uses the early answer instead of asking again)
  const sent: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) sent.push(u.pathname + u.search); });
  await page.reload();
  await expect(page.locator('tr', { hasText: 'E2E worker' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  // (the test server is `next dev`, where React runs every effect twice: 2 = the early request + the second run; asking again would make 3. Production: 1)
  for (const u of remembered) expect(sent.filter((x) => x === u).length, u).toBeLessThanOrEqual(2);
  expect(await page.evaluate((u) => u in ((window as any).__pre || {}), listUrl)).toBe(false); // the early answer was taken

  // one layout only on a computer: the table, no hidden copy of every row as a card
  expect(await page.locator('main table').count()).toBe(1);
  expect(await page.locator('main .cv-auto').count()).toBe(0);

  // a list seen before in this tab comes back at once (no skeleton) when the screen is opened again
  await page.locator('aside a[href="/stock"]').first().click();
  await expect(page).toHaveURL(/\/stock/);
  await page.locator('aside a[href="/employees"]').first().click();
  await expect(page.locator('tr', { hasText: 'E2E worker' })).toBeVisible({ timeout: 2000 });
});

test('Owner: opening the dashboard does not prefetch every screen of the sidebar', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, 'owner');
  const prefetches: string[] = [];
  page.on('request', (r) => { if (r.headers()['next-router-prefetch'] || r.headers()['rsc']) prefetches.push(new URL(r.url()).pathname); });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(prefetches.length, prefetches.join(' ')).toBeLessThanOrEqual(6);
});

test('on a phone the list is cards, with no hidden table', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 360, height: 780 });
  await signIn(page, 'owner');
  await page.goto('/employees');
  await expect(page.locator('.cv-auto', { hasText: 'E2E worker' })).toBeVisible();
  expect(await page.locator('main table').count()).toBe(0);
});
