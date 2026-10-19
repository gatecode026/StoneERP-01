import { test, expect } from '@playwright/test';
import { signIn, SAME_ORIGIN } from './helpers';

// A decision on a daily report is final: the OK / Not OK buttons go away, and the Owner can undo with a reason.
test.use({ viewport: { width: 1100, height: 800 } }); // the table with the row buttons is the computer layout
test('Owner: OK removes the buttons, Undo (with a reason) brings them back', async ({ page }) => {
  await signIn(page, 'owner');
  const emp = await page.request.post('/api/employees', { headers: SAME_ORIGIN, data: { empCode: 'E100', name: 'Report Person', job: 'Helper', payType: 'daily', rate: 500, mobile: '9811100100' } });
  expect(emp.status(), await emp.text()).toBe(201);
  const rep = await page.request.post('/api/dailyreports', { headers: SAME_ORIGIN, data: { empCode: 'E100', narration: 'Cut 200 sq ft of pavers', hours: 8, quantity: 200 } });
  expect(rep.status(), await rep.text()).toBe(201);

  await page.goto('/daily-report');
  const row = page.locator('tr', { hasText: 'Report Person' });
  await expect(row).toBeVisible();
  // the row's actions are in its "Actions" menu (the menu opens over the page, not inside the row)
  const menu = async () => { await row.getByRole('button', { name: 'Actions' }).click(); };
  const item = (name: string) => page.getByRole('menuitem', { name });
  await menu();
  await expect(item('Mark OK')).toBeVisible();
  await expect(item('Mark not OK')).toBeVisible();

  await item('Mark OK').click();
  await expect(page.getByText('Marked OK').first()).toBeVisible();
  await menu();
  await expect(item('Mark OK')).toHaveCount(0);
  await expect(item('Mark not OK')).toHaveCount(0);
  await expect(item('Edit')).toHaveCount(0); // an OK report is locked
  await expect(item('Undo decision')).toBeVisible();

  await item('Undo decision').click();
  await page.getByRole('textbox').last().fill('Tapped OK by mistake');
  await page.getByRole('button', { name: /^OK$/ }).last().click();
  await expect(page.getByText('Decision undone').first()).toBeVisible();
  await menu();
  await expect(item('Mark OK')).toBeVisible();
  await expect(item('Undo decision')).toHaveCount(0);
});
