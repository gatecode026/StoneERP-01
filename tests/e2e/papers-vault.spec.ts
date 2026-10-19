import { test, expect, type Page } from '@playwright/test';
import { signIn, SAME_ORIGIN } from './helpers';

// Important papers as a document vault: overview, folders, upload, search, recycle bin (on a 360 px phone).
const uid = Date.now().toString().slice(-6);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const post = async (page: Page, path: string, data: object) => {
  const r = await page.request.post(path, { headers: SAME_ORIGIN, data });
  expect(r.status(), `${path} ${await r.text()}`).toBeLessThan(300);
  return r.json();
};
const ask = async (page: Page, answer: string) => { await page.locator('#dlg_input').fill(answer); await page.locator('#dlg_input').press('Enter'); };

test('Owner: the vault shows what needs attention, folders, search, a new paper with its scan, and the recycle bin', async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, 'owner');
  await post(page, '/api/documents', { name: `Truck insurance ${uid}`, category: 'Insurance', expiryDate: day(-5), tags: ['truck'] });
  await post(page, '/api/documents', { name: `Loader insurance ${uid}`, category: 'Insurance', expiryDate: day(10) });
  await post(page, '/api/documents', { name: `GST certificate ${uid}`, category: 'Company', tags: ['tax', `gst${uid}`] });

  // ---- overview: counts and the papers that need attention
  await page.goto('/papers');
  await expect(page.getByRole('heading', { name: 'Important papers' })).toBeVisible();
  await expect(page.getByText('Papers kept').first()).toBeVisible();
  await expect(page.getByText('Needs attention').first()).toBeVisible();
  await expect(page.getByText(`Truck insurance ${uid}`).first()).toBeVisible();
  await expect(page.getByText(/Expired 5d ago/).first()).toBeVisible();

  // ---- folders: a folder per kind of paper, with how many and how many need attention
  await page.getByRole('button', { name: /^Folders$/ }).click();
  await expect(page.getByRole('button', { name: /Insurance/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /^Insurance/ }).first().click();
  await page.getByPlaceholder(/Search papers/).fill(`Loader insurance ${uid}`); // this run's paper only (the database keeps those of earlier runs)
  await expect(page.getByText(`Loader insurance ${uid}`).first()).toBeVisible();
  await page.getByRole('button', { name: 'List view' }).click();
  await expect(page.getByText(`Loader insurance ${uid}`).first()).toBeVisible();
  await page.getByRole('button', { name: 'Grid view' }).click();
  await page.getByRole('button', { name: /^Folders$/ }).first().click(); // back to the folders

  // ---- search finds a paper by its tag, across every folder
  await page.getByPlaceholder(/Search papers/).fill(`gst${uid}`);
  await expect(page.getByText(`GST certificate ${uid}`).first()).toBeVisible();
  await expect(page.getByText(`Loader insurance ${uid}`)).toHaveCount(0);
  await page.getByPlaceholder(/Search papers/).fill('');

  // ---- a new paper: the scan is needed, the dates must make sense
  await page.getByRole('button', { name: /Add a paper/ }).click();
  await page.getByLabel('Paper name').fill(`Mining lease ${uid}`);
  await page.getByRole('button', { name: 'Save paper' }).click();
  await expect(page.getByText('Add the scan or photo of the paper').first()).toBeVisible();
  await page.getByTestId('paper-file').setInputFiles({ name: 'lease.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('Photo attached')).toBeVisible();
  await page.getByLabel('Folder').selectOption('Licence');
  await page.getByLabel('Issue date').fill(day(-30));
  await page.getByLabel(/^Expiry date/).fill(day(-60));
  await page.getByRole('button', { name: 'Save paper' }).click();
  await expect(page.getByText('The paper expires before it was issued').first()).toBeVisible();
  await page.getByLabel(/^Expiry date/).fill(day(200));
  await page.getByLabel('Where the original is kept').fill('Office locker 2');
  await page.getByLabel('Tags (separated by commas)').fill('Mining, LEASE, mining');
  await page.getByLabel('Description (optional)').fill('Khasra 214, Bijoliya');
  await page.getByRole('button', { name: 'Save paper' }).click();
  await expect(page.getByText('Paper added').first()).toBeVisible();
  const saved = (await (await page.request.get(`/api/documents?q=Mining lease ${uid}`)).json()).data[0];
  expect(saved).toMatchObject({ category: 'Licence', originalAt: 'Office locker 2', note: 'Khasra 214, Bijoliya' });
  expect(saved.tags).toEqual(['mining', 'lease']);
  expect(saved.file).toMatch(/^docs\/.+\.jpg$/); // the scan is in storage; the paper keeps only its key

  // ---- delete with a reason, find it in the recycle bin, restore it
  await page.getByRole('button', { name: /^Folders$/ }).first().click();
  await page.getByPlaceholder(/Search papers/).fill(`Mining lease ${uid}`);
  const card = page.locator('div.card').filter({ hasText: `Mining lease ${uid}` }).first();
  await card.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await ask(page, 'Replaced by the new lease');
  await expect(page.getByText('Moved to the recycle bin').first()).toBeVisible();
  await page.getByRole('button', { name: /^Recycle bin/ }).click();
  await page.getByPlaceholder(/Search papers/).fill(`Mining lease ${uid}`);
  await expect(page.getByText('Replaced by the new lease').first()).toBeVisible();
  const binned = page.locator('div.card').filter({ hasText: `Mining lease ${uid}` }).first();
  await binned.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Restore' }).click();
  await expect(page.getByText('Paper restored').first()).toBeVisible();
  expect((await (await page.request.get(`/api/documents?q=Mining lease ${uid}`)).json()).data).toHaveLength(1);
});
