import { test, expect, type Page } from '@playwright/test';
import { signIn, SAME_ORIGIN } from './helpers';

// Settings → Company details: the GST number is set there, and then a GST bill can be issued (on a 360 px phone).
const uid = Date.now().toString().slice(-4);
const post = async (page: Page, path: string, data: object) => {
  const r = await page.request.post(path, { headers: SAME_ORIGIN, data });
  expect(r.status(), `${path} ${await r.text()}`).toBeLessThan(300);
  return r.json();
};

test('Owner: the company sets its GST number in Settings and then issues a GST bill', async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, 'owner');
  // start without a GST number, whatever an earlier run left
  const clear = await page.request.put('/api/settings', { headers: SAME_ORIGIN, data: { company: { gstin: '' } } });
  expect(clear.status()).toBe(200);
  const item = await post(page, '/api/stockitems', { name: `Slab ${uid}`, category: 'finished', unit: 'sq ft', openingBalance: 500, sellRate: 100 });
  const cust = await post(page, '/api/customers', { name: `Buyer ${uid}`, mobile: '9823' + uid + '11', state: 'Rajasthan' });
  const sale = await post(page, '/api/sales', { customerId: cust._id, stage: 'order', items: [{ stockItemId: item._id, name: item.name, qty: 10, unit: 'sq ft', rate: 100, gstRate: 18 }] });

  // ---- without the number the order screen says so, and the bill is refused
  await page.goto(`/sales/${sale._id}`);
  await expect(page.getByText(/company GST number is not set/i).first()).toBeVisible();
  await page.getByRole('link', { name: /Set it in Settings/ }).click();
  await expect(page.getByText('Company details (printed on bills and quotations)')).toBeVisible();
  await expect(page.getByText(/GST number is not set yet/i)).toBeVisible();

  // ---- a wrong number is explained; a right one fills the state and its code
  const gst = page.getByLabel('GST number');
  await gst.fill('abc');
  await gst.blur();
  await expect(page.getByText(/GST number must be 15 characters/i).first()).toBeVisible();
  await gst.fill(`08abcde${uid}f1z5`);
  await expect(gst).toHaveValue(`08ABCDE${uid}F1Z5`);
  await expect(page.getByLabel('State', { exact: true })).toHaveValue('Rajasthan');
  await expect(page.getByLabel('State code')).toHaveValue('08');
  await page.getByLabel('Phone').fill('abc');
  await expect(page.getByLabel('Phone')).toHaveValue(''); // letters never get in
  await page.locator('section', { has: page.getByText('Company details (printed on bills and quotations)') }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved').first()).toBeVisible();
  await expect(page.getByText(/GST number is set\. GST bills can be issued/)).toBeVisible();
  expect((await (await page.request.get('/api/settings')).json().then((s) => s.company)).gstin).toBe(`08ABCDE${uid}F1Z5`);

  // ---- now the GST bill is issued from the order screen
  await page.goto(`/sales/${sale._id}`);
  await expect(page.getByText(/company GST number is not set/i)).toHaveCount(0);
  await page.getByRole('button', { name: /Generate GST bill/ }).click();
  await page.waitForURL(new RegExp(`/sales/${sale._id}/invoice`));
  const after = await (await page.request.get(`/api/sales/${sale._id}`)).json();
  expect(after.invoiceNo).toMatch(/^VSS\//);
  expect(after).toMatchObject({ taxType: 'cgst_sgst', cgst: 90, sgst: 90 });
});
