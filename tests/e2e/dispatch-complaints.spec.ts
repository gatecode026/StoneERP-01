import { test, expect, type Page } from '@playwright/test';
import { signIn, SAME_ORIGIN } from './helpers';

// Dispatch & Gate Pass and Complaints on a 360 px phone.
const uid = Date.now().toString().slice(-6);
const post = async (page: Page, path: string, data: object) => {
  const r = await page.request.post(path, { headers: SAME_ORIGIN, data });
  expect(r.status(), `${path} ${await r.text()}`).toBeLessThan(300);
  return r.json();
};
const choose = async (page: Page, id: string, text: RegExp | string) => {
  await page.locator(`#${id}`).click();
  await page.locator('[role=option], ul[role=listbox] li').filter({ hasText: text }).first().click();
};
const ok = (page: Page) => page.getByRole('button', { name: /^(Yes|OK|Confirm)/i }).last().click();

test('Owner: loading slips know what is left, the e-way bill is asked for, late details can be added, freight is paid', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, 'owner');
  const slab = await post(page, '/api/stockitems', { name: `Slab ${uid}`, category: 'finished', unit: 'sq ft', sellRate: 60, openingBalance: 5000 });
  const cust = await post(page, '/api/customers', { name: `Kota Buyer ${uid}`, mobile: '9827' + uid });
  const order = await post(page, '/api/sales', { customerId: cust._id, stage: 'order', items: [{ stockItemId: slab._id, name: slab.name, qty: 100, unit: 'sq ft', rate: 60, gstRate: 0 }] });

  // ---- a loading slip for 60 of the 100: the truck number is checked, the quantity cannot exceed what is left
  await page.goto('/dispatch');
  await page.getByRole('button', { name: /New loading slip/ }).click();
  await page.getByPlaceholder('Search order or customer…').fill(`Kota Buyer ${uid}`);
  await page.locator('[role=option], ul[role=listbox] li').filter({ hasText: `Kota Buyer ${uid}` }).first().click();
  await page.getByLabel(/^Quantity loaded/).fill('150');
  await page.getByLabel(/^Truck number/).fill('x1');
  await page.getByRole('button', { name: /Truck out|Save loading slip/ }).last().click();
  await expect(page.getByText(/Only 100 left to send/i).first()).toBeVisible();
  await page.getByLabel(/^Quantity loaded/).fill('60');
  await page.getByLabel(/^Truck number/).fill('rj14 ga 7001');
  await expect(page.getByLabel(/^Truck number/)).toHaveValue('RJ14 GA 7001');
  await page.getByLabel(/^Driver mobile/).fill('abc98290 12345');
  await expect(page.getByLabel(/^Driver mobile/)).toHaveValue('9829012345');
  await page.getByLabel(/^E-way bill number/).fill('12345');
  await page.getByRole('button', { name: /Truck out|Save loading slip/ }).last().click();
  await expect(page.getByText(/E-way bill number must be exactly 12 digits/i).first()).toBeVisible();
  await page.getByLabel(/^E-way bill number/).fill('');
  await page.getByLabel(/^Freight/).fill('3500');
  await page.getByLabel(/Guard marks the truck out now/).uncheck(); // only the loading slip for now
  await page.getByRole('button', { name: /Save loading slip/ }).click();
  await expect(page.getByText(/Gate pass issued/i).first()).toBeVisible();

  // ---- the next slip for the same order is offered only what is left (40), not the whole order
  await page.getByRole('button', { name: /New loading slip/ }).click();
  await page.getByPlaceholder('Search order or customer…').fill(`Kota Buyer ${uid}`);
  await page.locator('[role=option], ul[role=listbox] li').filter({ hasText: `Kota Buyer ${uid}` }).first().click();
  await expect(page.getByText(/60 already on a loading slip/i)).toBeVisible();
  await expect(page.getByLabel(/^Quantity loaded/)).toHaveValue('40');
  await page.keyboard.press('Escape');

  // ---- the guard marks the first truck out (₹3,600 of stone: no e-way bill is needed)
  const row = page.locator('tbody tr, [class*=card]').filter({ hasText: 'RJ14 GA 7001' }).first();
  await row.getByRole('button').last().click();
  await page.getByRole('menuitem', { name: /Mark out/ }).first().click();
  await ok(page);
  await expect(page.getByText(/Truck marked out/i).first()).toBeVisible();
  let sale = await (await page.request.get(`/api/sales/${order._id}`)).json();
  expect(sale.dispatchedQty[slab._id]).toBe(60);
  const slips = await (await page.request.get(`/api/dispatches?saleId=${order._id}`)).json();
  const first = slips.data.find((d: { truckNo: string }) => d.truckNo === 'RJ14 GA 7001');
  expect(first).toMatchObject({ status: 'out', driverMobile: '9829012345', freight: 3500 });

  // ---- after it left: the e-way bill is added late, the truck number cannot be changed
  await page.goto('/dispatch');
  const out = page.locator('tbody tr, [class*=card]').filter({ hasText: 'RJ14 GA 7001' }).first();
  await out.getByRole('button').last().click();
  await page.getByRole('menuitem', { name: /^Edit/ }).first().click();
  await page.locator('#f_eway').fill('123456789012');
  await page.locator('#f_truckNo').fill('RJ14 GA 7002');
  await page.getByRole('button', { name: /^(Submit|Save)$/i }).click();
  await expect(page.getByText(/already left/i).first()).toBeVisible();
  await page.locator('#f_truckNo').fill('RJ14 GA 7001');
  await page.getByRole('button', { name: /^(Submit|Save)$/i }).click();
  await expect(page.locator('#f_eway')).toHaveCount(0); // the form closed: saved
  expect((await (await page.request.get(`/api/dispatches/${first._id}`)).json()).eway).toBe('123456789012');

  // ---- the gate pass shows the truck, the papers and lets the freight be marked paid
  await page.goto(`/dispatch/${first._id}`);
  await expect(page.getByText('RJ14 GA 7001').first()).toBeVisible();
  await expect(page.getByText('123456789012').first()).toBeVisible();
  await page.getByRole('button', { name: /Freight paid/ }).click();
  await page.locator('#dlg_input').fill('Cash');
  await page.locator('#dlg_input').press('Enter');
  await expect(page.getByText(/Freight marked paid/i).first()).toBeVisible();
  expect((await (await page.request.get(`/api/dispatches/${first._id}`)).json()).freightPaid).toBe(true);

  // ---- ₹60,000 on one truck with no e-way bill: the guard is asked
  const big = await post(page, '/api/sales', { customerId: cust._id, stage: 'order', items: [{ stockItemId: slab._id, name: slab.name, qty: 1000, unit: 'sq ft', rate: 60, gstRate: 0 }] });
  const bigSlip = await post(page, '/api/dispatches', { saleId: big._id, truckNo: 'RJ14 GA 7003', items: [{ stockItemId: slab._id, name: slab.name, qty: 1000 }] });
  await page.goto(`/dispatch/${bigSlip._id}`);
  await page.getByRole('button', { name: /Guard: mark truck out/ }).click();
  await expect(page.getByText(/No e-way bill number is entered/i).first()).toBeVisible();
  await ok(page);
  await expect(page.getByText(/Truck marked out/i).first()).toBeVisible();
  sale = await (await page.request.get(`/api/sales/${big._id}`)).json();
  expect(sale.dispatchedQty[slab._id]).toBe(1000);
});

test('Owner: a complaint is checked, linked to the staff member, closed only after an action, and listed by month', async ({ page }) => {
  await signIn(page, 'owner');
  const cust = await post(page, '/api/customers', { name: `Complaint Co ${uid}`, mobile: '9826' + uid });
  const staff = await post(page, '/api/employees', { name: `Mohan ${uid}`, mobile: '9825' + uid, job: 'Worker / operator', payType: 'daily', rate: 600, _confirmed: true });

  await page.goto('/complaints');
  await page.getByRole('button', { name: /^\s*\+?\s*Add\b/i }).first().click();
  await choose(page, 'f_customerId', `Complaint Co ${uid}`);
  await page.locator('#f_date').fill('2030-01-01');
  await page.locator('#f_problem').selectOption('Other');
  await page.getByRole('button', { name: /^(Submit|Save)$/i }).click();
  await expect(page.getByText(/Date cannot be in the future/i).first()).toBeVisible();
  await page.locator('#f_date').fill(new Date().toLocaleDateString('en-CA'));
  await page.getByRole('button', { name: /^(Submit|Save)$/i }).click();
  await expect(page.getByText(/Describe the problem/i).first()).toBeVisible(); // "Other" needs words
  await page.locator('#f_details').fill('Wrong colour batch delivered');
  await page.locator('#f_invoiceNo').fill('vss/2026-27/9999');
  await expect(page.locator('#f_invoiceNo')).toHaveValue('VSS/2026-27/9999');
  await choose(page, 'f_linkedCode', new RegExp(`Mohan ${uid}`));
  await page.locator('#f_state').selectOption('closed');
  await page.getByRole('button', { name: /^(Submit|Save)$/i }).click();
  await expect(page.getByText(/Decide the action before closing/i).first()).toBeVisible();
  await page.locator('#f_state').selectOption('open');
  await page.getByRole('button', { name: /^(Submit|Save)$/i }).click();
  await expect(page.getByText(/not found for/i).first()).toBeVisible(); // an unknown bill is asked about
  await ok(page);
  await expect(page.getByText(/Complaint saved/i).first()).toBeVisible();
  const list = await (await page.request.get(`/api/complaints?customerId=${cust._id}`)).json();
  const c = list.data[0];
  expect(c).toMatchObject({ problem: 'Other', invoiceNo: 'VSS/2026-27/9999', linkedCode: staff.empCode, linkedName: `Mohan ${uid}`, state: 'open' });

  // ---- "Close" without an action decided is refused with the way forward
  await page.reload();
  const row = page.locator('tbody tr, [class*=card]').filter({ hasText: c.complaintNo }).first();
  await row.getByRole('button').last().click();
  await page.getByRole('menuitem', { name: /^Close/ }).first().click();
  await expect(page.getByText(/Decide the action first/i).first()).toBeVisible();

  // ---- the action is decided in Edit, then it closes, with the days taken
  const row2 = page.locator('tbody tr, [class*=card]').filter({ hasText: c.complaintNo }).first();
  await row2.getByRole('button').last().click();
  await page.getByRole('menuitem', { name: /^Edit/ }).first().click();
  await page.locator('#f_action').selectOption('replace');
  await page.locator('#f_state').selectOption('closed');
  await page.getByRole('button', { name: /^(Submit|Save)$/i }).click();
  await expect(page.getByText(/Complaint saved/i).first()).toBeVisible();
  const closed = await (await page.request.get(`/api/complaints/${c._id}`)).json();
  expect(closed).toMatchObject({ state: 'closed', action: 'replace', daysTaken: 0 });

  // ---- the monthly list by problem type
  await expect(page.getByText('Complaints by problem type')).toBeVisible();
  await expect(page.locator('span.w-40', { hasText: 'Other' })).toBeVisible(); // a bar for the problem type, counted this month
});

test('Owner: an incoming truck is entered and corrected, and the freight of a transporter is paid by the mode chosen', async ({ page }) => {
  await signIn(page, 'owner');
  const slab = await post(page, '/api/stockitems', { name: `Cobble ${uid}`, category: 'finished', unit: 'pieces', sellRate: 10, openingBalance: 500 });
  const cust = await post(page, '/api/customers', { name: `Freight Buyer ${uid}`, mobile: '9824' + uid });
  const order = await post(page, '/api/sales', { customerId: cust._id, stage: 'order', items: [{ stockItemId: slab._id, name: slab.name, qty: 100, unit: 'pieces', rate: 10, gstRate: 0 }] });
  const transporter = `Sharma Roadlines ${uid}`;
  for (const [i, freight] of [[1, 1200], [2, 800]] as const) {
    const s = await post(page, '/api/dispatches', { saleId: order._id, truckNo: `RJ14 GB ${7000 + i}`, transporter, freight, items: [{ stockItemId: slab._id, name: slab.name, qty: 10 }] });
    await post(page, `/api/dispatches/${s._id}/out`, {});
  }

  // ---- incoming truck
  await page.goto('/dispatch');
  await page.getByRole('button', { name: /^Trucks in$/ }).click();
  await page.getByRole('button', { name: /Truck in/ }).first().click();
  await page.locator('#f_truckNo').fill('x1');
  await page.locator('#f_driverName').fill('9999');
  await page.getByRole('button', { name: /^(Submit|Save)$/i }).click();
  await expect(page.getByText(/truck number as it is painted/i).first()).toBeVisible();
  await page.locator('#f_truckNo').fill('rj14 gb 5005');
  await page.locator('#f_driverName').fill('Kailash Gurjar');
  await page.locator('#f_emptyWeight').fill('9000');
  await page.locator('#f_loadedWeight').fill('4000');
  await page.getByRole('button', { name: /^(Submit|Save)$/i }).click();
  await expect(page.getByText(/Loaded weight is less than the empty weight/i).first()).toBeVisible();
  await page.locator('#f_loadedWeight').fill('31000');
  await page.getByRole('button', { name: /^(Submit|Save)$/i }).click();
  await expect(page.getByText('RJ14 GB 5005').first()).toBeVisible();
  const incoming = (await (await page.request.get('/api/dispatches?direction=in&q=RJ14 GB 5005')).json()).data[0];
  expect(incoming).toMatchObject({ truckNo: 'RJ14 GB 5005', kind: 'Blocks', netWeight: 22000, status: 'in' });

  // ---- freight: a transporter's pending freight is paid in one go, by the mode chosen
  await page.getByRole('button', { name: /^Freight$/ }).click();
  const row = page.locator('tr, [class*=card]').filter({ hasText: transporter }).first();
  await expect(row).toContainText('2,000');
  await row.getByRole('button', { name: /Mark paid/ }).click();
  await page.locator('#dlg_input').fill('Cash');
  await page.locator('#dlg_input').press('Enter');
  await expect(page.getByText(/Marked paid/i).first()).toBeVisible();
  const after = (await (await page.request.get(`/api/dispatches?saleId=${order._id}`)).json()).data;
  expect(after.every((d: { freightPaid: boolean }) => d.freightPaid)).toBe(true);
});
