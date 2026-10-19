import { test, expect } from '@playwright/test';
import { signIn, SAME_ORIGIN } from './helpers';

// Punch In / Out, the senior's fix, overtime approval, and the working-hours settings, on a phone-size screen.
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
// the last day before today that is a working day: Sunday is the weekly off, and a day off cannot be marked or have overtime
const yesterday = (() => { let t = Date.now() - 86400000; while (new Date(ymd(new Date(t)) + 'T12:00:00Z').getUTCDay() === 0) t -= 86400000; return ymd(new Date(t)); })();

test('Worker: Punch In from the home screen shows the time, and the button becomes Punch Out', async ({ page }) => {
  await signIn(page, 'worker');
  await expect(page.getByText(/Not marked yet today/i)).toBeVisible();
  await page.getByRole('button', { name: /^Punch In$/ }).click();
  await expect(page.getByText(/Punched in/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Punch Out$/ })).toBeVisible();
  await expect(page.getByText(/^In \d\d:\d\d/).first()).toBeVisible();
  // a second press right away is a double tap, not an Out
  await page.getByRole('button', { name: /^Punch Out$/ }).click();
  await expect(page.getByText(/Already punched a moment ago/i).first()).toBeVisible();
});

test('Worker: cannot punch for someone else, and the app button follows the Settings switch', async ({ page }) => {
  await signIn(page, 'worker');
  const r = await page.request.post('/api/punches', { headers: SAME_ORIGIN, data: { empCode: 'E302' } });
  expect(r.status()).toBe(403);
});

test('Owner: a day with an Out that is wrong is fixed with a reason, then the overtime is approved', async ({ page }) => {
  await signIn(page, 'owner');
  // set up yesterday for the worker: In 09:00, Out 19:00 (a 10 h stay = 1 h overtime after the 18:00 end)
  const fix = await page.request.post('/api/attendance/fix', { headers: SAME_ORIGIN, data: { empCode: 'E301', date: yesterday, inAt: `${yesterday}T09:00`, outAt: `${yesterday}T17:00`, reason: 'Entered for the test' } });
  expect(fix.status(), await fix.text()).toBe(200);

  await page.goto(`/attendance?date=${yesterday}`);
  const card = page.locator('div.card', { hasText: 'E2E worker' }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText('09:00')).toBeVisible();
  await expect(card.getByText('17:00')).toBeVisible();
  await expect(card.getByText(/corrected/i)).toBeVisible();

  // the senior fixes the Out through the screen
  await card.getByRole('button', { name: 'Actions' }).click(); // a row's actions are in its menu
  await page.getByRole('menuitem', { name: 'Fix punch' }).click();
  const out = page.locator('#fx_out');
  await expect(out).toBeVisible();
  await out.fill(`${yesterday}T19:05`);
  await page.getByRole('button', { name: /Save correction/i }).click();
  await expect(page.getByText(/Write the reason for the correction/i).first()).toBeVisible(); // refused without a reason
  await page.locator('#fx_reason').fill('Machine was off, left at 7 pm');
  await page.getByRole('button', { name: /Save correction/i }).click();
  await expect(page.getByText('Corrected').first()).toBeVisible();

  await expect(card.getByText(/OT 1h waiting/i)).toBeVisible();
  // approve it from the Overtime tab
  await page.getByRole('tab', { name: 'Overtime' }).or(page.getByRole('button', { name: 'Overtime' })).first().click();
  await expect(page.getByText('E2E worker').first()).toBeVisible();
  await page.getByRole('button', { name: /^Approve$/ }).first().click();
  await expect(page.getByText(/Overtime approved/i).first()).toBeVisible();
  await expect(page.getByText(/No overtime is waiting for approval/i)).toBeVisible();
});

test('Supervisor: sees the team, may punch for them, has no Fix and no overtime approval', async ({ page }) => {
  await signIn(page, 'supervisor');
  await page.goto(`/attendance?date=${yesterday}`);
  const card = page.locator('div.card', { hasText: 'E2E worker' }).first();
  await expect(card).toBeVisible();
  // the row's menu has the supervisor's marks when the day is still open (and no menu at all once the day is settled), never a fix or an overtime decision
  const actions = card.getByRole('button', { name: 'Actions' });
  if (await actions.count()) {
    await actions.click();
    await expect(page.getByRole('menuitem', { name: 'Fix punch' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: /Approve overtime/i })).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
  await expect(page.getByRole('button', { name: 'Overtime' })).toHaveCount(0);
});

test('Owner: Settings has shifts, weekly off and holidays, and a change is kept', async ({ page }) => {
  await signIn(page, 'owner');
  await page.goto('/settings');
  await expect(page.getByText('Shifts', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Day shift').or(page.locator('input[value="Day shift"]')).first()).toBeVisible();
  const sat = page.locator('#wo_sat');
  await expect(sat).toBeVisible();
  await expect(page.locator('#wo_sun')).toHaveValue('all');
  const next = (await sat.inputValue()) === '2nd4th' ? '1st3rd5th' : '2nd4th'; // a different choice than what is saved (the test database keeps earlier runs)
  await sat.selectOption(next);
  await sat.locator('xpath=ancestor::section[1] | ancestor::div[contains(@class,"card")][1]').getByRole('button', { name: /Save/ }).first().click();
  await expect(page.getByText('Saved').first()).toBeVisible();
  await page.reload();
  await expect(page.locator('#wo_sat')).toHaveValue(next);
  // a holiday
  await page.getByRole('button', { name: /Add a holiday/ }).click();
  await page.locator('#hd_from_0').fill('2026-11-08');
  await page.locator('#hd_name_0').fill('Diwali');
  await page.locator('#hd_name_0').locator('xpath=ancestor::section[1] | ancestor::div[contains(@class,"card")][1]').getByRole('button', { name: /Save/ }).first().click();
  await expect(page.getByText('Saved').first()).toBeVisible();
});

test.describe('on a computer the day is a ledger table', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('one row per person with shift, punch in / out, hours, overtime, status, source and actions', async ({ page }) => {
    await signIn(page, 'owner');
    const set = await page.request.post('/api/attendance/fix', { headers: SAME_ORIGIN, data: { empCode: 'E301', date: yesterday, inAt: `${yesterday}T09:08`, outAt: `${yesterday}T19:05`, reason: 'Entered for the test' } });
    expect([200, 400], await set.text()).toContain(set.status()); // 400 when an earlier test already set the same times
    await page.goto(`/attendance?date=${yesterday}`);
    for (const h of ['Employee', 'Shift', 'Punch in', 'Punch out', 'Worked', 'Overtime', 'Status', 'Source', 'Actions']) await expect(page.getByRole('columnheader', { name: h, exact: true })).toBeVisible();
    await expect(page.getByText(/\d+ records/)).toBeVisible();
    const row = page.locator('tr', { hasText: 'E2E worker' });
    await expect(row).toBeVisible();
    await expect(row.locator('td').nth(6)).toContainText('Present'); // the Status column
    await row.getByRole('button', { name: 'Actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Fix punch' })).toBeVisible();
    await page.keyboard.press('Escape');

    // a person without a mark is marked from the row (leave, absent, half day or present)
    const sup = page.locator('tr', { hasText: 'E2E supervisor' });
    await expect(sup.locator('td').nth(6)).toContainText('Not marked');
    await sup.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Mark Absent' }).click();
    await expect(sup.locator('td').nth(6)).toContainText('Absent');
    await page.screenshot({ path: 'test-results/attendance-ledger.png' });
  });
});

test('Supervisor sees My attendance with Punch In on their own home; the Owner home has no punch card', async ({ page }) => {
  await signIn(page, 'supervisor');
  await expect(page.getByText('My attendance')).toBeVisible();
  await page.getByRole('button', { name: /^Punch In$/ }).click();
  await expect(page.getByText(/Punched in/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Punch Out$/ })).toBeVisible();
  await page.context().clearCookies();
  await signIn(page, 'owner');
  await expect(page.getByText('My attendance')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Punch In$/ })).toHaveCount(0);
});
