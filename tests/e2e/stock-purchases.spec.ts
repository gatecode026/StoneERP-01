import { test, expect, type Page } from '@playwright/test';
import { signIn, SAME_ORIGIN } from './helpers';

// Stock and Purchases update by themselves and can be followed day by day; the monthly physical count corrects the stock (on a 360 px phone).
const uid = Date.now().toString().slice(-6);
const year = 2000 + (Number(uid) % 25); // a month of its own for the count, so a re-run on the same database does not meet its own count
const ago = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA'); };

const post = async (page: Page, path: string, data: object) => {
  const r = await page.request.post(path, { headers: SAME_ORIGIN, data });
  expect(r.status(), `${path} ${await r.text()}`).toBeLessThan(300);
  return r.json();
};

test('Owner: stock day by day follows purchases, production and sales; a monthly count corrects it', async ({ page }) => {
  await signIn(page, 'owner');
  const name = `Slab ${uid}`;
  const item = await post(page, '/api/stockitems', { name, category: 'finished', unit: 'sq ft', openingBalance: 0 });
  const sup = await post(page, '/api/suppliers', { name: `Kota ${uid}`, mobile: '9826' + uid });
  await post(page, '/api/stockmovements', { type: 'in', itemId: item._id, qty: 500, date: ago(3), ref: 'Production' });
  await post(page, '/api/stockmovements', { type: 'out', itemId: item._id, qty: 120, date: ago(2), ref: 'Gate pass' });
  await post(page, '/api/purchases', { supplierId: sup._id, itemId: item._id, qty: 200, rate: 40, date: ago(1), billNo: `B-${uid}`, paidNow: true, payMode: 'Cash' });
  const balance = async () => (await (await page.request.get(`/api/stockitems?q=${name}`)).json()).data[0].balance;
  expect(await balance()).toBe(580); // 500 − 120 + 200: every entry moved it by itself

  // day by day
  await page.goto('/stock');
  await page.getByRole('button', { name: /^Day by day$/ }).click();
  await page.locator('input[placeholder="Choose an item…"]').fill(name);
  await page.locator('[role=option], ul[role=listbox] li').filter({ hasText: name }).first().click();
  await expect(page.getByText('Stock, day by day')).toBeVisible();
  await expect(page.getByText('Every entry adds up to the balance shown.')).toBeVisible();
  await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible();
  const daily = await (await page.request.get(`/api/stockitems/daily?itemId=${item._id}&days=7`)).json();
  expect(daily.days.find((d: { date: string }) => d.date === ago(2))).toMatchObject({ in: 0, out: 120 });
  expect(daily.days.find((d: { date: string }) => d.date === ago(1))).toMatchObject({ in: 200, closing: 580 });

  // monthly count: type what is on the floor, see the difference, the owner confirms
  await page.getByRole('button', { name: /^Monthly count$/ }).click();
  await page.locator('input[type=month]').fill(`${year}-01`);
  await page.getByRole('button', { name: /Start the count/ }).click();
  await expect(page.getByText(`Stock count ${year}-01`)).toBeVisible();
  const counted = page.getByLabel(`Counted ${name}`);
  await counted.fill('565');
  await expect(page.getByText('-15').first()).toBeVisible();
  await page.getByLabel(`Reason for the difference ${name}`).fill('Broken pieces not entered');
  await page.getByRole('button', { name: /Save the count/ }).click();
  await expect(page.getByText(/Count saved/i).first()).toBeVisible();
  expect(await balance()).toBe(580); // not corrected until confirmed
  await page.getByRole('button', { name: /Confirm and correct the stock/ }).click();
  await page.getByRole('button', { name: /^(Yes|OK|Confirm)/i }).last().click();
  await expect(page.getByText(/Count confirmed/i).first()).toBeVisible();
  expect(await balance()).toBe(565);
  const after = await (await page.request.get(`/api/stockitems/daily?itemId=${item._id}&days=7`)).json();
  expect(after.reconciles).toBe(true);
  expect(after.days[after.days.length - 1]).toMatchObject({ closing: 565 });
});

test('Owner: purchases day by day draws what was bought, paid and still to pay', async ({ page }) => {
  await signIn(page, 'owner');
  const item = await post(page, '/api/stockitems', { name: `Diesel ${uid}`, category: 'consumable', unit: 'litres', openingBalance: 0 });
  const sup = await post(page, '/api/suppliers', { name: `Pump ${uid}`, mobile: '9825' + uid });
  await post(page, '/api/purchases', { supplierId: sup._id, itemId: item._id, qty: 100, rate: 90, date: ago(2), billNo: `P1-${uid}`, paidNow: true, payMode: 'Cash' });
  const credit = await post(page, '/api/purchases', { supplierId: sup._id, itemId: item._id, qty: 50, rate: 90, date: ago(1), billNo: `P2-${uid}` });
  expect(credit.dueDate).toBe(ago(-29)); // no due date typed: 30 days after the purchase

  await page.goto('/purchases');
  await page.getByRole('button', { name: /^Day by day$/ }).click();
  await expect(page.getByText('Purchases, day by day')).toBeVisible();
  await expect(page.getByText('Top suppliers')).toBeVisible();
  await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible();
  await expect(page.locator('tr, [class*=card]').filter({ hasText: /₹4,500/ }).first()).toBeVisible(); // the credit bill of the day: 50 × ₹90
});
