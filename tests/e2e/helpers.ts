import { expect, type Page } from '@playwright/test';

export const USERS = {
  owner: { mobile: '9800000001', password: 'Owner-Pass-12345' },
  supervisor: { mobile: '9800000002', password: 'Super-Pass-12345' },
  worker: { mobile: '9800000003', password: 'Worker-Pass-12345' },
} as const;

export async function signIn(page: Page, who: keyof typeof USERS) {
  await page.goto('/login');
  await page.locator('#username').fill(USERS[who].mobile);
  await page.locator('#password').fill(USERS[who].password);
  await page.locator('button[type=submit]').click();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('header')).toBeVisible();
  // the app starts in Hindi (its button then reads "EN"); the tests read English
  const toggle = page.getByRole('button', { name: /language|भाषा/i }).first();
  if ((await toggle.innerText()).trim() === 'EN') {
    await toggle.click();
    await expect(toggle).not.toHaveText('EN');
  }
}

/** True when the page scrolls sideways (anything wider than the screen). */
export async function overflowsSideways(page: Page) {
  // a screen can still be redirecting or hydrating; try again if the page changed under us
  for (let i = 0; ; i++) {
    try {
      await page.waitForLoadState('domcontentloaded');
      return await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    } catch (e) {
      if (i >= 3) throw e;
      await page.waitForTimeout(500);
    }
  }
}

/** A write the way the app itself sends it (same-origin). */
export const SAME_ORIGIN = { origin: `http://localhost:${process.env.E2E_PORT ?? 3100}` };
