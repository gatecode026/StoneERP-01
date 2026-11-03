import { test, expect } from '@playwright/test';
import { signIn, overflowsSideways } from './helpers';

// Roles and permissions: the Owner adds a role by typing only its name, sees it as a tab, and can then choose it as a Job.
const uid = Date.now().toString().slice(-5);

test('Owner: "New role" asks only for a name, shows the role as a tab, offers it as a Job, and refuses a duplicate', async ({ page }) => {
  test.setTimeout(180_000);
  const name = `Electrician ${uid}`;
  await signIn(page, 'owner');
  await page.goto('/settings/roles');
  await expect(page.getByRole('heading', { name: 'Roles and permissions' })).toBeVisible();

  // the button sits with the role tabs, and the dialog has ONE field
  const add = page.getByRole('button', { name: /New role/ });
  await expect(add).toBeVisible();
  await add.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('#dlg_msg')).toContainText('Name of the new role');
  await expect(dialog.locator('input')).toHaveCount(1);
  await dialog.locator('input').fill(name);
  await dialog.getByRole('button', { name: 'OK' }).click();

  // the new role is a tab, already selected, marked as an added role, with the hint about the Job
  const tab = page.getByRole('tab', { name });
  await expect(tab).toBeVisible();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('added role', { exact: true })).toBeVisible();
  await expect(page.getByText(`choose “${name}” as their Job`)).toBeVisible();
  await expect(page.getByRole('button', { name: /Delete role/ })).toBeVisible();
  expect(await overflowsSideways(page)).toBe(false);

  // it can be set up like any other role and saved
  const firstSee = page.locator('select[aria-label$="– See"]').first();
  await firstSee.selectOption('all');
  await expect(page.getByText('unsaved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Save/ }).click();
  await expect(page.getByText('Saved. The change applies to this role immediately.')).toBeVisible();

  // a second role with the same name is refused with a clear message, and no second tab appears
  await add.click();
  await dialog.locator('input').fill(name.toUpperCase());
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByText(/There is already a role called/)).toBeVisible();
  await expect(page.getByRole('tab', { name: new RegExp(name, 'i') })).toHaveCount(1);

  // and the Employees form now offers it as a Job
  await page.goto('/employees');
  await page.getByRole('button', { name: /^\s*\+?\s*Add\b/i }).first().click();
  await expect(page.locator('#f_job').locator('option', { hasText: name })).toHaveCount(1);

  // it can be deleted again while nobody has it
  await page.goto('/settings/roles');
  await page.getByRole('tab', { name }).click();
  await page.getByRole('button', { name: /Delete role/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Role deleted')).toBeVisible();
  await expect(page.getByRole('tab', { name })).toHaveCount(0);
});

test('Owner: typing "Manager" (a role that already exists) switches it on: saved, shown as a tab, offered in the Job and role dropdowns', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, 'owner');
  await page.goto('/settings/roles');
  await expect(page.getByRole('tab', { name: 'Manager' })).toHaveCount(0);

  await page.getByRole('button', { name: /New role/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input').fill('Manager');
  await dialog.getByRole('button', { name: 'OK' }).click();

  await expect(page.getByText(/There is already a role called/)).toHaveCount(0); // not an error any more
  const tab = page.getByRole('tab', { name: 'Manager' });
  await expect(tab).toBeVisible();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: /Remove from list/ })).toBeVisible();

  // it is saved: still there after a reload
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Manager' })).toBeVisible();

  // and it is offered in the dropdowns: the Job on the employee form, and the role filter on the attendance screen
  await page.goto('/employees');
  await page.getByRole('button', { name: /^\s*\+?\s*Add\b/i }).first().click();
  await expect(page.locator('#f_job').locator('option', { hasText: 'Manager' })).toHaveCount(1);
  await page.goto('/attendance');
  await expect(page.getByLabel('Filter by role').locator('option', { hasText: 'Manager' })).toHaveCount(1);

  // take it off the lists again (the Manager role itself stays in the app)
  await page.goto('/settings/roles');
  await page.getByRole('tab', { name: 'Manager' }).click();
  await page.getByRole('button', { name: /Remove from list/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Removed from the lists')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Manager' })).toHaveCount(0);
});
