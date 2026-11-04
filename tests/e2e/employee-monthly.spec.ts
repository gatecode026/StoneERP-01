import { test, expect } from '@playwright/test';
import { signIn, overflowsSideways, SAME_ORIGIN } from './helpers';

// Daily Work Report -> "Employee monthly report": choose an employee and a month, see every report of that month in full.
const uid = Date.now().toString().slice(-5);
const now = new Date();
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const thisFirst = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
const lastFirst = ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1));
const monthLabel = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

test('Owner: picks an employee, sees the month’s reports in detail, and moves to the previous month', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, 'owner');
  const post = (data: object) => page.request.post('/api/dailyreports', { headers: SAME_ORIGIN, data });
  const r1 = await post({ empCode: 'E301', date: thisFirst, narration: `Cut grey slabs ${uid}`, hours: 8, quantity: 120, problem: `Blade broke ${uid}`, plan: `Fix the blade ${uid}`, monthly: true });
  const r2 = await post({ empCode: 'E301', date: lastFirst, narration: `Polished the yard stone ${uid}`, hours: 7, quantity: 90, monthly: true });
  expect([201, 409]).toContain(r1.status());
  expect([201, 409]).toContain(r2.status());

  await page.goto('/daily-report');
  await page.getByRole('button', { name: 'Employee monthly report' }).click();
  await expect(page.getByText('Choose an employee to see all the reports')).toBeVisible();

  // choose the employee
  const picker = page.getByRole('combobox').first();
  await picker.click();
  await picker.fill('E2E worker');
  await page.getByText(/E2E worker/).first().click();
  await expect(page.getByRole('heading', { name: /E2E worker/ })).toBeVisible();

  // this month: the summary, the calendar and the report in full
  await expect(page.getByText('Reports submitted')).toBeVisible();
  await expect(page.getByText('Days with a report')).toBeVisible();
  await expect(page.getByText(`Cut grey slabs ${uid}`)).toBeVisible();
  await expect(page.getByText(`Blade broke ${uid}`)).toBeVisible(); // the problem
  await expect(page.getByText(`Fix the blade ${uid}`)).toBeVisible(); // the plan for tomorrow
  await expect(page.getByText(`Polished the yard stone ${uid}`)).toHaveCount(0); // last month's report is not here
  expect(await overflowsSideways(page)).toBe(false);

  // the previous month
  await page.getByRole('button', { name: 'Last month' }).click();
  await expect(page.getByText(`Polished the yard stone ${uid}`)).toBeVisible();
  await expect(page.getByText(`Cut grey slabs ${uid}`)).toHaveCount(0);
  await expect(page.getByText(monthLabel(new Date(now.getFullYear(), now.getMonth() - 1, 1))).first()).toBeVisible();

  // a month nobody reported in says so, and "next month" brings us forward again
  await page.locator('#em_month').fill(ymd(new Date(now.getFullYear() - 1, 0, 1)).slice(0, 7));
  await expect(page.getByText(/No reports from E2E worker in/)).toBeVisible();
  await page.getByRole('button', { name: 'This month' }).click();
  await expect(page.getByText(`Cut grey slabs ${uid}`)).toBeVisible();

  // a report opens in full from its card
  await page.getByRole('button', { name: 'Open full report', exact: true }).first().click();
  await expect(page.getByText(/Report · E2E worker/)).toBeVisible(); // the full report (with its photos and the supervisor's decision) opens
});
