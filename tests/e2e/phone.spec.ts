import { test, expect } from '@playwright/test';
import { signIn, overflowsSideways } from './helpers';

// The yard uses phones: every screen must fit a 360 px wide display with no sideways scrolling.
const SCREENS = ['/', '/employees', '/attendance', '/daily-report', '/machines', '/stock', '/sales', '/purchases', '/expenses', '/cash', '/salary', '/dispatch', '/blocks', '/yield', '/repairs', '/vehicles', '/complaints', '/tasks', '/papers', '/safety', '/performance', '/audit', '/settings'];

test('Owner: every screen fits a 360 px phone', async ({ page }) => {
  test.setTimeout(900_000);
  await signIn(page, 'owner');
  const wide: string[] = [];
  for (const path of SCREENS) {
    await page.goto(path);
    await expect(page.locator('header').first()).toBeVisible();
    await page.waitForLoadState('networkidle').catch(() => undefined);
    if (await overflowsSideways(page)) wide.push(path);
  }
  expect(wide, `screens that scroll sideways: ${wide.join(', ')}`).toEqual([]);
});

test('Owner: the language toggle switches to Hindi and back', async ({ page }) => {
  await signIn(page, 'owner'); // signIn leaves the app in English
  const toggle = () => page.getByRole('button', { name: /language|भाषा/i }).first();
  const english = await page.locator('main').innerText();
  expect(english).not.toMatch(/[ऀ-ॿ]/);
  await toggle().click();
  await expect.poll(async () => page.locator('main').innerText()).toMatch(/[ऀ-ॿ]/);
  await toggle().click();
  await expect.poll(async () => page.locator('main').innerText()).not.toMatch(/[ऀ-ॿ]/);
});
