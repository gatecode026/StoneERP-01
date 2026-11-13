import { test, expect, type Page } from '@playwright/test';
import { signIn, SAME_ORIGIN } from './helpers';

// Machine Work: the block dropdown lists blocks, the shift sets the times, waste needs a reason, and saving moves stock and the block.
test.use({ viewport: { width: 1100, height: 1000 } });

const uid = Date.now().toString().slice(-6);
const choose = async (page: Page, id: string, text: RegExp) => {
  await page.locator(`#${id}`).click();
  await page.locator('[role=option], ul[role=listbox] li').filter({ hasText: text }).first().click();
};

// the Machine field lists machines with check boxes (one entry can cover several machines) and closes with Done
const pickMachine = async (page: Page, text: RegExp) => {
  await page.locator('#f_machineId').click();
  await page.getByText(text).first().click(); // a row of the list toggles its check box
  await page.getByRole('button', { name: 'Done', exact: true }).click();
};

test('Owner: an ordinary machine saves its output, and a CNC machine gets its own form', async ({ page }) => {
  await signIn(page, 'owner');
  const post = async (path: string, data: object) => {
    const r = await page.request.post(path, { headers: SAME_ORIGIN, data });
    expect(r.status(), `${path} ${await r.text()}`).toBeLessThan(300);
    return r.json();
  };
  const machineName = `Gang saw ${uid}`;
  const cncName = `CNC router ${uid}`;
  await post('/api/machines', { name: machineName, type: 'Gang saw', location: 'Factory' });
  await post('/api/machines', { name: cncName, type: 'CNC', location: 'Factory' });

  // an ordinary machine: the standard form (work done, output, photo, remarks) and no CNC fields
  await page.goto('/machines');
  await page.getByRole('button', { name: /New entry/ }).first().click();
  await pickMachine(page, new RegExp(machineName));
  await expect(page.locator('#f_outputSqft')).toBeVisible();
  await expect(page.locator('#f_programName')).toHaveCount(0);
  await choose(page, 'f_operatorCode', /E2E worker/);
  await page.locator('#f_workDone').fill(`Cut slabs ${uid}`);
  await page.locator('#f_outputSqft').fill('410');
  await page.getByRole('button', { name: /^(Submit|Save)$/i }).click();
  await expect(page.getByText(/Machine entry saved/i).first()).toBeVisible();
  let entries = await (await page.request.get('/api/machineentries?limit=5')).json();
  expect(entries.data[0]).toMatchObject({ machineName, workDone: `Cut slabs ${uid}`, outputSqft: 410 });

  // a CNC machine: its own fields (program, tools, times); the ordinary output field is not asked
  await page.getByRole('button', { name: /New entry/ }).first().click();
  await pickMachine(page, new RegExp(cncName));
  await expect(page.locator('#f_programName')).toBeVisible();
  await expect(page.locator('#f_toolName')).toBeVisible();
  await expect(page.locator('#f_startTime')).toBeVisible();
  await expect(page.locator('#f_outputSqft')).toHaveCount(0);
  await choose(page, 'f_operatorCode', /E2E worker/);
  await page.locator('#f_programName').fill(`Rosette ${uid}`);
  await page.locator('#f_toolName').fill('Flat 6 mm');
  await page.getByRole('button', { name: /^(Submit|Save)$/i }).click();
  await expect(page.getByText(/Machine entry saved/i).first()).toBeVisible();
  entries = await (await page.request.get('/api/machineentries?limit=5')).json();
  expect(entries.data[0]).toMatchObject({ machineName: cncName, programName: `Rosette ${uid}`, toolName: 'Flat 6 mm' });
  expect(entries.data[0].workDone).toContain(`Rosette ${uid}`);
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
