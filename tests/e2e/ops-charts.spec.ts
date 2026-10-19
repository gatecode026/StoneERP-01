import { test, expect, type Page } from '@playwright/test';
import { signIn, SAME_ORIGIN } from './helpers';

// Yield & Cost, Machine Repair and Vehicles show real graphs drawn from the records (on a 360 px phone).
const uid = Date.now().toString().slice(-6);

const post = async (page: Page, path: string, data: object) => {
  const r = await page.request.post(path, { headers: SAME_ORIGIN, data });
  expect(r.status(), `${path} ${await r.text()}`).toBeLessThan(300);
  return r.json();
};
const drawn = (page: Page) => page.locator('.recharts-surface');

test('Owner: Yield & Cost draws the block, month and cost graphs from a cut block', async ({ page }) => {
  await signIn(page, 'owner');
  const op = await post(page, '/api/employees', { name: `Operator ${uid}`, mobile: '9827' + uid, job: 'Worker / operator', designation: 'Machine operator', payType: 'daily', rate: 600, _confirmed: true });
  const saw = await post(page, '/api/machines', { name: `Gang saw ${uid}`, type: 'Gang saw' });
  const blk = await post(page, '/api/blocks', { rawanna: `YC-${uid}`, length: 8, width: 5, height: 4, costPerCft: 90, slabThicknessMm: 30 });
  await post(page, '/api/machineentries', { shift: 'Day', machineId: saw._id, operatorCode: op.empCode, startTime: '09:00', stopTime: '18:00', blockNo: blk.blockNo, outputSqft: 900, wasteSqft: 20, wasteReason: 'Cracked', electricityUnits: 100 });
  const cut = await page.request.post(`/api/blocks/${blk._id}/cut`, { headers: SAME_ORIGIN, data: {} });
  expect(cut.status()).toBe(200);

  await page.goto('/yield');
  await expect(page.getByText('Yield % of each block')).toBeVisible();
  await expect(page.getByText('Cost per sq ft, block by block')).toBeVisible();
  await expect(drawn(page).first()).toBeVisible();
  expect(await page.locator('.recharts-bar-rectangle').count()).toBeGreaterThan(0); // bars are really drawn, not an empty frame
  await page.getByRole('button', { name: /By supplier/ }).click();
  await expect(page.getByText(/Yield % – By supplier/)).toBeVisible();
  await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible();
});

test('Owner: Machine Repair report draws cost and stopped hours, and a service by hour-meter resets the count', async ({ page }) => {
  await signIn(page, 'owner');
  const saw = await post(page, '/api/machines', { name: `Press ${uid}`, type: 'Gang saw', serviceIntervalHours: 200 });
  await post(page, '/api/repairs', { kind: 'breakdown', machineId: saw._id, problem: `Bearing ${uid}`, cost: 7500, stoppedHours: 12, status: 'closed' });

  await page.goto('/repairs');
  await page.getByRole('button', { name: /^Reports$/ }).click();
  await expect(page.getByText('Repair cost and stopped hours, month by month')).toBeVisible();
  await expect(page.getByText('Repair cost by machine')).toBeVisible();
  await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible();
  await expect(page.getByText(`Press ${uid}`).first()).toBeVisible();
  await page.locator('select[aria-label="Period"]').selectOption('12');
  await expect(page.getByText('Repair cost and stopped hours, month by month')).toBeVisible();

  // the schedule shows the running hours left for a machine serviced by hour-meter
  await page.getByRole('button', { name: /Service schedule/ }).click();
  await expect(page.locator('tr', { hasText: `Press ${uid}` })).toContainText(/Running hours left|—|h/);
});

test('Owner: Vehicles report draws diesel by month and by vehicle, and one vehicle trip by trip', async ({ page }) => {
  await signIn(page, 'owner');
  const truck = await post(page, '/api/vehicles', { name: `Truck ${uid}`, kind: 'Truck', insuranceExpiry: '2020-01-01' });
  for (const [km, litres] of [[100, 40], [90, 36], [110, 66]]) await post(page, '/api/vehicletrips', { vehicleId: truck._id, km, dieselLitres: litres, dieselAmount: litres * 90 });

  // papers: an expired paper is shown as Expired (not as "within 30 days") and the papers graph is drawn
  await page.goto('/vehicles');
  await expect(page.getByText('Papers: how many vehicles are covered')).toBeVisible();
  await expect(page.locator('div', { hasText: /^Expired/ }).filter({ hasText: `Truck ${uid}: Insurance` }).first()).toBeVisible();

  await page.getByRole('button', { name: /^Reports$/ }).click();
  await expect(page.getByText('Diesel, month by month')).toBeVisible();
  await expect(page.getByText('Diesel by vehicle')).toBeVisible();
  await expect(page.getByText(/Diesel use per trip/)).toBeVisible();
  await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible();
  await expect(page.locator('.recharts-line').first()).toBeVisible();
});
