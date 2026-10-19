import { test, expect, type Page } from '@playwright/test';
import { signIn, SAME_ORIGIN } from './helpers';

// The photo and document boxes on the forms, used the way a person uses them (choose a file, Save), then read back. Files are kept in the database, as on the live site.
test.use({ viewport: { width: 1280, height: 900 } });
const uid = Date.now().toString().slice(-6);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const KEY = /^(photos|docs)\/\d{4}\/\d{2}\/[0-9a-f-]+\.jpg$/;
const post = async (page: Page, path: string, data: object) => {
  const r = await page.request.post(path, { headers: SAME_ORIGIN, data });
  expect(r.status(), `${path} ${await r.text()}`).toBeLessThan(300);
  return r.json();
};
const choose = (page: Page, nth: number, name = 'pic.png') => page.locator('input[type=file]').nth(nth).setInputFiles({ name, mimeType: 'image/png', buffer: PNG });
/** Every picture a record points at can be opened, and is a JPEG. */
async function openable(page: Page, keys: string[]) {
  for (const k of keys) {
    expect(k).toMatch(KEY);
    const r = await page.request.get(`/api/files/${k}`);
    expect(r.status(), k).toBe(200);
    expect(r.headers()['content-type']).toBe('image/jpeg');
    expect((await page.request.get(`/api/files/${k}?thumb=1`)).status(), `${k} thumbnail`).toBe(200);
  }
}

test('Owner: an employee gets a photo and the four documents while editing, changes one, removes one (no "Something went wrong")', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errors.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  await signIn(page, 'owner');
  const emp = await post(page, '/api/employees', { name: `Photo Person ${uid}`, job: 'Helper', payType: 'daily', rate: 500, mobile: '9826' + uid, _confirmed: true });

  await page.goto('/employees');
  await page.getByPlaceholder(/search/i).first().fill(`Photo Person ${uid}`);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.locator('tbody tr').first().getByRole('button').last().click();
  await page.getByRole('menuitem', { name: /^Edit/ }).first().click();

  // the form has a profile photo and four document boxes (Aadhaar, PAN, bank passbook, driving licence)
  await expect(page.locator('input[type=file]')).toHaveCount(5);
  for (let i = 0; i < 5; i++) await choose(page, i);
  await expect(page.locator('form img, [role=dialog] img').first()).toBeVisible();
  await page.getByRole('button', { name: /^(Submit|Save)$/i }).click();
  await expect(page.getByText(/saved|updated/i).first()).toBeVisible();
  await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);

  const saved = await (await page.request.get(`/api/employees/${emp._id}`)).json();
  const keys = ['photo', 'docAadhaar', 'docPan', 'docPassbook', 'docLicense'].map((f) => saved[f]);
  expect(keys.every(Boolean), JSON.stringify(keys)).toBe(true);
  await openable(page, keys);
  expect(saved.docFlags).toMatchObject({ aadhaar: true, pan: true, passbook: true, license: true });

  // edit again: the pictures are shown, one is changed ("Change"), another removed (the X), then saved
  await page.locator('tbody tr').first().getByRole('button').last().click();
  await page.getByRole('menuitem', { name: /^Edit/ }).first().click();
  await expect(page.getByRole('button', { name: 'Change' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Change' }).nth(1).click(); // the Aadhaar picture
  await choose(page, 1, 'aadhaar-new.png');
  await page.getByTitle('Remove').nth(3).click(); // the passbook picture
  await page.getByRole('button', { name: /^(Submit|Save)$/i }).click();
  await expect(page.getByText(/saved|updated/i).first()).toBeVisible();

  const after = await (await page.request.get(`/api/employees/${emp._id}`)).json();
  expect(after.docAadhaar).toMatch(KEY);
  expect(after.docAadhaar).not.toBe(saved.docAadhaar); // a new file
  expect(after.docPan).toBe(saved.docPan); // untouched pictures keep their file
  expect(after.docPassbook || '').toBe(''); // removed
  expect(after.docFlags).toMatchObject({ aadhaar: true, passbook: false });
  await openable(page, [after.photo, after.docAadhaar, after.docPan, after.docLicense]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Owner: an expense takes its bill photo; the photo opens from the list; a damaged file is refused with a clear message', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, 'owner');
  const exp = await post(page, '/api/expenses', { head: 'Diesel', amount: 1800, paidBy: 'UPI', billPhoto: 'data:image/png;base64,' + PNG.toString('base64') });
  expect(exp.billPhoto).toMatch(KEY);
  await openable(page, [exp.billPhoto]);

  // the Add form: choose the bill photo, save
  await page.goto('/expenses');
  await page.getByRole('button', { name: 'Add', exact: true }).click(); // not "Add head"
  await expect(page.locator('input[type=file]').first()).toBeAttached();
  await choose(page, 0, 'bill.png');
  await expect(page.locator('[role=dialog] img, form img').first()).toBeVisible();

  // a file that only looks like a picture is refused without a crash
  const bad = await page.request.post('/api/files', { headers: SAME_ORIGIN, multipart: { kind: 'photos', resource: 'expenses', file: { name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('not really a picture') } } });
  expect(bad.status()).toBe(400);
  const cut = await page.request.post('/api/expenses', { headers: SAME_ORIGIN, data: { head: 'Diesel', amount: 10, paidBy: 'UPI', billPhoto: 'data:image/png;base64,' + PNG.subarray(0, 40).toString('base64'), _confirmed: true } });
  expect(cut.status(), await cut.text()).toBe(400); // a picture cut short is a 400 with a message, never a 500
  expect(await cut.text()).toMatch(/damaged|not a valid image|Must be an image/i);
});
