import { test, expect } from '@playwright/test';
import { signIn, USERS } from './helpers';

test.describe('sign-in', () => {
  test('a wrong password is refused and stays on the sign-in page', async ({ page }) => {
    await page.goto('/login');
    // a number nobody has: failed attempts on a real account would lock it for the other tests
    await page.locator('#username').fill('9800000099');
    await page.locator('#password').fill('not-the-password-1');
    await page.locator('button[type=submit]').click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('an unsigned visitor is sent to the sign-in page', async ({ page }) => {
    await page.goto('/salary');
    await expect(page).toHaveURL(/\/login/);
  });

  test('the Owner signs in, sees the home screen and signs out', async ({ page }) => {
    await signIn(page, 'owner');
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole('button', { name: /logout|log out|sign out/i }).first().click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/cash');
    await expect(page).toHaveURL(/\/login/);
  });

  test('the session cookie is HttpOnly and the page cannot read it', async ({ page, context }) => {
    await signIn(page, 'owner');
    const cookie = (await context.cookies()).find((c) => /vss_session/.test(c.name));
    expect(cookie?.httpOnly).toBe(true);
    expect(await page.evaluate(() => document.cookie)).not.toMatch(/vss_session/);
  });
});
