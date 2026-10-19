import { test, expect, type Page } from '@playwright/test';
import { signIn, SAME_ORIGIN } from './helpers';

// Sales & Payments on a 360 px phone: the forms stop wrong entries as they are typed, and the flow runs from customer to cancelled payment.
const uid = Date.now().toString().slice(-6);
const pick = async (page: Page, placeholder: string, text: string | RegExp) => {
  await page.getByPlaceholder(placeholder).first().fill(typeof text === 'string' ? text : '');
  await page.locator('[role=option], ul[role=listbox] li').filter({ hasText: text }).first().click();
};
const ask = async (page: Page, answer: string) => { await page.locator('#dlg_input').fill(answer); await page.locator('#dlg_input').press('Enter'); };

test('Owner: a customer, a quotation, changing it, the order, a cheque, a wrong payment cancelled, and a truck', async ({ page }) => {
  await signIn(page, 'owner');
  const slab = `Slab ${uid}`;
  const item = await (await page.request.post('/api/stockitems', { headers: SAME_ORIGIN, data: { name: slab, category: 'finished', unit: 'sq ft', sellRate: 50, openingBalance: 2000 } })).json();

  // ---- the customer form: the mobile number takes digits only
  await page.goto('/sales/new');
  await page.getByRole('button', { name: /New$/ }).click();
  await page.locator('#f_mobile').fill('ab98290-12x345');
  await expect(page.locator('#f_mobile')).toHaveValue('9829012345'); // letters and dashes never get in
  await page.locator('#f_mobile').fill('+91 98290 12345 99');
  await expect(page.locator('#f_mobile')).toHaveValue('91982901234599'.slice(0, 12)); // pasted +91: digits kept, length limited, tidied on leaving
  await page.locator('#f_mobile').fill('9829' + uid);

  await page.locator('#f_name').fill('=bad');
  await page.getByRole('button', { name: 'Save customer' }).click();
  await expect(page.getByText(/Name can have letters/i).first()).toBeVisible();
  await page.locator('#f_name').fill(`Delhi Builders ${uid}`);
  await page.locator('#f_gstin').fill('07aaaaa0000a1z5');
  await expect(page.locator('#f_gstin')).toHaveValue('07AAAAA0000A1Z5');
  await page.getByRole('button', { name: 'Save customer' }).click(); // the state is still Rajasthan, the GST number is Delhi's
  await expect(page.getByText(/belongs to Delhi|is for Delhi/i).first()).toBeVisible();
  await page.locator('#f_state').selectOption('Delhi');
  await page.getByRole('button', { name: 'Save customer' }).click();
  await expect(page.getByText('Customer added').first()).toBeVisible();

  // ---- the quotation: a half-filled line is not silently dropped
  await pick(page, 'Search product…', slab);
  await page.getByRole('button', { name: 'Save quotation' }).click();
  await expect(page.getByText(/Item 1: Enter the quantity/i).first()).toBeVisible();
  await page.getByLabel(/^Quantity/).fill('100');
  await page.getByRole('button', { name: 'Save quotation' }).click();
  await page.waitForURL(/\/sales\/[0-9a-f]{24}$/);
  const saleId = page.url().split('/').pop()!;
  let sale = await (await page.request.get(`/api/sales/${saleId}`)).json();
  expect(sale).toMatchObject({ stage: 'quotation', taxType: 'igst', total: 5900 }); // 100 × 50 + 18% IGST (a Delhi GST number)

  // ---- change the quotation, then make it an order
  await page.getByRole('link', { name: /Change quotation/ }).click();
  await page.getByLabel(/^Quantity/).fill('120');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Quotation updated').first()).toBeVisible();
  await page.waitForURL(new RegExp(`/sales/${saleId}$`));
  sale = await (await page.request.get(`/api/sales/${saleId}`)).json();
  expect(sale.total).toBe(7080);
  await page.getByRole('button', { name: /Convert to order/ }).click();
  await page.getByRole('button', { name: 'Confirm order' }).click();
  await expect(page.getByText('Order confirmed').first()).toBeVisible();

  // ---- a payment: not more than is pending, a cheque has its number
  await page.getByRole('button', { name: /Add payment/ }).click();
  await page.getByLabel(/^Amount/).fill('99999');
  await page.getByRole('button', { name: 'Save payment' }).click();
  await expect(page.getByText(/more than the .* pending/i).first()).toBeVisible();
  await page.getByLabel(/^Amount/).fill('1000');
  await page.getByLabel(/^Mode/).selectOption('Cheque');
  await page.getByRole('button', { name: 'Save payment' }).click();
  await expect(page.getByText('Enter the cheque number').first()).toBeVisible();
  await page.getByLabel(/^Cheque number/).fill('12345');
  await page.getByRole('button', { name: 'Save payment' }).click();
  await expect(page.getByText('A cheque number is 6 digits').first()).toBeVisible();
  await page.getByLabel(/^Cheque number/).fill('123456');
  await page.getByRole('button', { name: 'Save payment' }).click();
  await expect(page.getByText('Payment recorded').first()).toBeVisible();
  sale = await (await page.request.get(`/api/sales/${saleId}`)).json();
  expect(sale).toMatchObject({ paid: 1000, outstanding: 6080 });

  // ---- a wrong payment is cancelled with a reason
  await page.getByRole('button', { name: 'Cancel this payment' }).click();
  await ask(page, 'Entered twice');
  await expect(page.getByText('Payment cancelled').first()).toBeVisible();
  sale = await (await page.request.get(`/api/sales/${saleId}`)).json();
  expect(sale).toMatchObject({ paid: 0, outstanding: 7080 });

  // ---- the truck: the number, the driver's mobile and the weights are checked
  await page.getByRole('button', { name: /Dispatch truck/ }).click();
  await page.getByLabel(/^Truck number/).fill('x1');
  await page.getByLabel(/^Driver mobile/).fill('abc98290 12345');
  await expect(page.getByLabel(/^Driver mobile/)).toHaveValue('9829012345');
  await page.getByLabel(/^Empty weight/).fill('9000');
  await page.getByLabel(/^Loaded weight/).fill('4000');
  await page.getByRole('button', { name: /Truck out/ }).click();
  await expect(page.getByText(/truck number as it is painted/i).first()).toBeVisible();
  await page.getByLabel(/^Truck number/).fill('rj14 ga 4321');
  await expect(page.getByLabel(/^Truck number/)).toHaveValue('RJ14 GA 4321');
  await page.getByRole('button', { name: /Truck out/ }).click();
  await expect(page.getByText(/Loaded weight is less than the empty weight/i).first()).toBeVisible();
  await page.getByLabel(/^Loaded weight/).fill('21000');
  await page.getByRole('button', { name: /Truck out/ }).click();
  await expect(page.getByText(/Truck out – stock deducted/i).first()).toBeVisible();
  const stock = (await (await page.request.get(`/api/stockitems/${item._id}`)).json()).balance;
  expect(stock).toBe(1880); // 2000 − the 120 sq ft loaded
});

test('Owner: a wrong quotation is cancelled with a reason, and an order with money cannot be', async ({ page }) => {
  await signIn(page, 'owner');
  const post = async (path: string, data: object) => { const r = await page.request.post(path, { headers: SAME_ORIGIN, data }); expect(r.status(), await r.text()).toBeLessThan(300); return r.json(); };
  const item = await post('/api/stockitems', { name: `Cobble ${uid}`, category: 'finished', unit: 'pieces', sellRate: 10, openingBalance: 500 });
  const c = await post('/api/customers', { name: `Cancel Co ${uid}`, mobile: '9828' + uid });
  const q = await post('/api/sales', { customerId: c._id, items: [{ stockItemId: item._id, name: item.name, qty: 10, unit: 'pieces', rate: 10, gstRate: 0 }] });
  await page.goto(`/sales/${q._id}`);
  await page.getByRole('button', { name: /Cancel this quotation/ }).click();
  await ask(page, 'Wrong customer');
  await page.waitForURL(/\/sales$/);
  expect((await (await page.request.get(`/api/sales?customerId=${c._id}`)).json()).data).toHaveLength(0); // cancelled: it is gone from the lists
  const o = await post('/api/sales', { customerId: c._id, stage: 'order', items: [{ stockItemId: item._id, name: item.name, qty: 10, unit: 'pieces', rate: 10, gstRate: 0 }], advance: 50, advanceMode: 'UPI' });
  await page.goto(`/sales/${o._id}`);
  await expect(page.getByRole('button', { name: /Cancel this order/ })).toHaveCount(0); // money has been received: cancel the payment first
});
