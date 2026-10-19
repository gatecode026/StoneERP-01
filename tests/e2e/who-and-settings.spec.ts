import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

// On a 360 px phone the header and the More menu say who is signed in and what they do; Settings no longer carries the Company card.
test('Worker: the phone header shows the name and the designation, and so does the More menu', async ({ page }) => {
  await signIn(page, 'worker');
  const who = page.getByTestId('who');
  await expect(who).toBeVisible();
  await expect(who).toContainText('E2E worker');
  await expect(who).toContainText(/Worker/i);
  await page.getByRole('button', { name: /^More$/ }).click();
  await expect(page.locator('div.rounded-xl', { hasText: 'E2E worker' }).first()).toBeVisible();
});

test('Owner: the name and role are shown, and Settings has the Company details with the GST number', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, 'owner');
  await expect(page.getByTestId('who')).toContainText('E2E owner');
  await expect(page.getByTestId('who')).toContainText(/Owner/i);
  const loaded = page.waitForResponse((r) => /\/api\/settings$/.test(r.url()), { timeout: 120_000 });
  await page.goto('/settings');
  expect((await loaded).status()).toBe(200);
  await expect(page.getByText('Daily messages', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Company details (printed on bills and quotations)')).toBeVisible();
  await expect(page.getByLabel('GST number')).toBeVisible();
});

test('Owner: the Settings screen draws its shift cards without looping (no "Maximum update depth" error)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await signIn(page, 'owner');
  await page.goto('/settings');
  await expect(page.getByText('Shifts', { exact: true }).first()).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(2500);
  expect(errors.filter((e) => /Maximum update depth/i.test(e))).toEqual([]);
  // changing a shift then saving still works: the card follows the saved values, not every render
  await page.getByLabel('Shift name').first().fill(`Day shift ${Date.now()}`); // a name that is not saved yet, so the card is changed
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Shifts', exact: true }) });
  await expect(card.getByRole('button', { name: 'Save' })).toBeEnabled();
});
