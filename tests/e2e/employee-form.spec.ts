import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

// The employee form checks each field as the person types and leaves it, and the server numbers the employee.
test('Owner: employee form validates every ID field and numbers the new employee automatically', async ({ page }) => {
  await signIn(page, 'owner');
  await page.goto('/employees');
  await page.getByRole('button', { name: /^\s*\+?\s*Add\b/i }).first().click();

  const f = (name: string) => page.locator(`#f_${name}`);
  await expect(f('empCode')).toHaveCount(0); // the number is given by the server when saved: there is nothing to type

  await f('name').fill('Ramesh Meena');
  await f('mobile').fill('+91 98290 77777');
  await f('job').selectOption({ index: 1 });
  await f('rate').fill('16000');

  // Aadhaar: only digits are kept, a wrong check digit is explained, the right one is accepted
  await f('aadhaarNo').fill('2341 2341 2347');
  await expect(f('aadhaarNo')).toHaveValue('234123412347');
  await f('aadhaarNo').blur();
  await expect(page.getByText('This Aadhaar number is not valid (check the digits)')).toBeVisible();
  await f('aadhaarNo').fill('234123412346');
  await f('aadhaarNo').blur();
  await expect(page.getByText('This Aadhaar number is not valid (check the digits)')).toHaveCount(0);

  // PAN is capitalised as it is typed, a wrong shape is explained
  await f('panNo').fill('abcde1234f');
  await expect(f('panNo')).toHaveValue('ABCDE1234F');
  await f('panNo').blur();
  await expect(page.getByText(/4th letter of a PAN/)).toBeVisible();
  await f('panNo').fill('ABCPE1234F');
  await f('panNo').blur();

  // bank account, IFSC, UPI
  await f('bankAccount').fill('1234');
  await f('bankAccount').blur();
  await expect(page.getByText('Account number must be 9 to 18 digits')).toBeVisible();
  await f('bankAccount').fill('1234 5678 9012');
  await expect(f('bankAccount')).toHaveValue('123456789012');
  await f('ifsc').fill('sbin0001234');
  await expect(f('ifsc')).toHaveValue('SBIN0001234');
  await f('upi').fill('Ramesh');
  await f('upi').blur();
  await expect(page.getByText(/UPI ID must look like name@bank/)).toBeVisible();
  await f('upi').fill('ramesh@oksbi');
  await f('upi').blur();

  // a bad value stops the save and says which field
  await f('emergencyMobile').fill('12345');
  await page.getByRole('button', { name: /^(Submit|Save)$/i }).click();
  await expect(page.getByText(/Emergency contact number: Enter a 10-digit mobile number/)).toBeVisible();
  await f('emergencyMobile').fill('');

  await page.getByRole('button', { name: /^(Submit|Save)$/i }).click();
  await expect(page.getByText(/Employee saved/i)).toBeVisible();
  await page.getByPlaceholder(/search/i).first().fill('Ramesh Meena');
  await expect(page.getByText(/EMP-\d{4}/).first()).toBeVisible();
});
