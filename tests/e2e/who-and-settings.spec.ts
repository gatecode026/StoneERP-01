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

test('Owner: the name and role are shown, and Settings has no Company card', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, 'owner');
  await expect(page.getByTestId('who')).toContainText('E2E owner');
  await expect(page.getByTestId('who')).toContainText(/Owner/i);
  const loaded = page.waitForResponse((r) => /\/api\/settings$/.test(r.url()), { timeout: 120_000 });
  await page.goto('/settings');
  expect((await loaded).status()).toBe(200);
  await expect(page.getByText('Daily messages', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Company \(printed on bills/)).toHaveCount(0);
  await expect(page.getByText('GST number')).toHaveCount(0);
});
