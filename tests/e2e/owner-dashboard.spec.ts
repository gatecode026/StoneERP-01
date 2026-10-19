import { test, expect, type Page } from '@playwright/test';
import { signIn, overflowsSideways, SAME_ORIGIN } from './helpers';

// The Owner's home: numbers with their trend, graphs drawn from the records, and numbers that move by themselves (on a 360 px phone).
const uid = Date.now().toString().slice(-4);
const post = async (page: Page, path: string, data: object) => {
  const r = await page.request.post(path, { headers: SAME_ORIGIN, data });
  expect(r.status(), `${path} ${await r.text()}`).toBeLessThan(300);
  return r.json();
};

test('Owner: the home shows live numbers and real graphs, and a new entry appears without reloading', async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, 'owner');
  const item = await post(page, '/api/stockitems', { name: `Dash slab ${uid}`, category: 'finished', unit: 'sq ft', openingBalance: 300, minLevel: 1000, sellRate: 100 });
  const cust = await post(page, '/api/customers', { name: `Dash buyer ${uid}`, mobile: '9824' + uid + '11', state: 'Rajasthan' });
  await post(page, '/api/sales', { customerId: cust._id, stage: 'order', items: [{ stockItemId: item._id, name: item.name, qty: 20, unit: 'sq ft', rate: 100, gstRate: 18 }] });
  await post(page, '/api/expenses', { head: 'Diesel', amount: 1200, paidBy: 'Cash', _confirmed: true });

  await page.goto('/');
  await expect(page.getByText(/Owner.s Daily Report/i)).toBeVisible();
  await expect(page.getByRole('status').getByText('Live')).toBeVisible();

  // the sections of the redesigned home
  for (const t of ['Business pulse', 'Machine output and idle time', 'Attendance, day by day', 'Machines today', 'Cash and bank', 'Stock against minimum']) await expect(page.getByText(t, { exact: true }).first()).toBeVisible();
  // graphs are really drawn (not empty frames): the pulse chart and the others
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
  expect(await page.locator('.recharts-surface').count()).toBeGreaterThanOrEqual(4);
  await expect(page.locator('main svg path[stroke="currentColor"]').first()).toBeAttached(); // the sparklines under the numbers
  // the item below its minimum is on the stock card
  await expect(page.getByText(`Dash slab ${uid}`).first()).toBeVisible();
  // the 7 / 14 / 30 day switch works
  await page.getByRole('button', { name: '30d' }).click();
  await expect(page.getByRole('button', { name: '30d' })).toHaveAttribute('aria-pressed', 'true');
  expect(await overflowsSideways(page)).toBe(false);

  // a new expense, entered elsewhere, shows on the open screen by itself
  const before = await page.locator('main a[href="/expenses"]').first().innerText();
  await post(page, '/api/expenses', { head: 'Repairs', amount: 3400, paidBy: 'Cash', _confirmed: true });
  await expect.poll(async () => page.locator('main a[href="/expenses"]').first().innerText(), { timeout: 45_000 }).not.toBe(before);
  await expect(page.getByText('Repairs', { exact: true }).first()).toBeVisible(); // and the donut's list has the new head

  // a past day is not "live"
  await page.locator('input[type=date]').fill('2020-01-01');
  await expect(page.getByRole('status').getByText('Past day')).toBeVisible();
});
