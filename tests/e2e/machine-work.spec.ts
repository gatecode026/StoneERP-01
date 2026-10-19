import { test, expect, type Page } from '@playwright/test';
import { signIn, SAME_ORIGIN } from './helpers';

// Machine Work: the block dropdown lists blocks, the shift sets the times, waste needs a reason, and saving moves stock and the block.
test.use({ viewport: { width: 1100, height: 1000 } });

const uid = Date.now().toString().slice(-6);
const choose = async (page: Page, id: string, text: RegExp) => {
  await page.locator(`#${id}`).click();
  await page.locator('[role=option], ul[role=listbox] li').filter({ hasText: text }).first().click();
};

test('Owner: a machine entry with a block, stock output, hour-meter, electricity and waste', async ({ page }) => {
  await signIn(page, 'owner');
  const post = async (path: string, data: object) => {
    const r = await page.request.post(path, { headers: SAME_ORIGIN, data });
    expect(r.status(), `${path} ${await r.text()}`).toBeLessThan(300);
    return r.json();
  };
  const machineName = `Gang saw ${uid}`;
  const slabName = `Slab ${uid}`;
  await post('/api/machines', { name: machineName, type: 'Gang saw', location: 'Factory' });
  await post('/api/stockitems', { name: slabName, category: 'finished', unit: 'sq ft', openingBalance: 0 });
  await post('/api/stockitems', { name: `Raw ${uid}`, category: 'raw', unit: 'CFT', openingBalance: 0 });
  const block = await post('/api/blocks', { rawanna: `RWN-${uid}`, length: 8, width: 5, height: 4, source: 'own' });

  await page.goto('/machines');
  await page.getByRole('button', { name: /New entry/ }).first().click();

  // the block dropdown works and lists the block (it was empty before: the server refused the filter)
  await page.locator('#f_blockNo').click();
  await expect(page.locator('[role=option], ul[role=listbox] li').filter({ hasText: `Block ${block.blockNo}` })).toBeVisible();
  await page.getByRole('heading', { name: /New entry/ }).click();

  // the shift sets the start and stop times (Settings → Working hours)
  await expect(page.locator('#f_startTime')).toHaveValue('09:00');
  await page.locator('#f_shift').selectOption('Night');
  await expect(page.locator('#f_startTime')).toHaveValue('21:00');
  await expect(page.locator('#f_stopTime')).toHaveValue('06:00');
  await page.locator('#f_shift').selectOption('Day');
  await expect(page.locator('#f_stopTime')).toHaveValue('18:00');

  await choose(page, 'f_machineId', new RegExp(machineName));
  await choose(page, 'f_operatorCode', /E2E worker/);
  await page.locator('#f_outputSqft').fill('410');
  await choose(page, 'f_blockNo', new RegExp(`Block ${block.blockNo}`));
  await choose(page, 'f_stockItemId', new RegExp(slabName));
  await page.locator('#f_hourMeterStart').fill('1200');
  await page.locator('#f_hourMeterEnd').fill('1209.5');
  await page.locator('#f_electricityReadingStart').fill('5000');
  await page.locator('#f_electricityReadingEnd').fill('5180');
  await page.locator('#f_wasteSqft').fill('12');

  // waste needs its reason
  await page.getByRole('button', { name: /^(Submit|Save)$/i }).click();
  await expect(page.getByText(/Reason for the waste is required/i).first()).toBeVisible();
  await page.locator('#f_wasteReason').fill('Slab cracked on the saw');
  await page.getByRole('button', { name: /^(Submit|Save)$/i }).click();
  await expect(page.getByText(/Machine entry saved/i).first()).toBeVisible();

  const entries = await (await page.request.get('/api/machineentries?limit=5')).json();
  expect(entries.data[0]).toMatchObject({ machineName, blockNo: block.blockNo, outputSqft: 410, hoursRun: 9.5, electricityUnits: 180, wasteSqft: 12, wasteReason: 'Slab cracked on the saw' });
  const items = await (await page.request.get(`/api/stockitems?q=${slabName}`)).json();
  expect(items.data[0].balance).toBe(410); // the output went into finished stock
  const blocks = await (await page.request.get(`/api/blocks?blockNo=${block.blockNo}`)).json();
  expect(blocks.data[0].stage).toBe('cutting'); // the block is now being cut
});

test('Owner: the Supervisor (team) dropdown on the Employee form lists supervisors', async ({ page }) => {
  await signIn(page, 'owner');
  await page.goto('/employees');
  await page.getByRole('button', { name: /^\s*\+?\s*Add\b/i }).first().click();
  await page.locator('#f_supervisorCode').click();
  await expect(page.locator('[role=option], ul[role=listbox] li').filter({ hasText: /E2E supervisor/ })).toBeVisible();
});

test('Owner: the Trips driver dropdown lists only employees marked Driver', async ({ page }) => {
  await signIn(page, 'owner');
  const make = async (name: string, designation?: string) => {
    const r = await page.request.post('/api/employees', { headers: SAME_ORIGIN, data: { name, job: 'Worker / operator', ...(designation ? { designation } : {}), payType: 'daily', rate: 600, mobile: '98' + String(Math.floor(10000000 + Math.random() * 89999999)), _confirmed: true } });
    expect(r.status(), await r.text()).toBeLessThan(300);
  };
  await make(`Driver ${uid}`, 'Driver');
  await make(`Loader ${uid}`, 'Loader');
  await page.goto('/vehicles');
  await page.getByRole('button', { name: /Trips/ }).first().click();
  await page.getByRole('button', { name: /^\s*\+?\s*(New|Add)\b/i }).first().click();
  await page.locator('#f_driverCode').click();
  const options = page.locator('[role=option], ul[role=listbox] li');
  await expect(options.filter({ hasText: `Driver ${uid}` })).toBeVisible();
  await expect(options.filter({ hasText: `Loader ${uid}` })).toHaveCount(0);
});
