import { test, expect, type Page } from '@playwright/test';
import { signIn, SAME_ORIGIN } from './helpers';

// Block Entry: a supplier block needs its supplier, the search finds a block by number, the details can be edited, and a royalty is marked paid in one tap.
test.use({ viewport: { width: 1100, height: 1000 } });

const uid = Date.now().toString().slice(-6);
const year = 2000 + (Number(uid) % 25);
const choose = async (page: Page, id: string, text: RegExp) => {
  await page.locator(`#${id}`).click();
  await page.locator('[role=option], ul[role=listbox] li').filter({ hasText: text }).first().click();
};

test('Owner: add, find, edit and cut a block; mark a royalty paid', async ({ page }) => {
  await signIn(page, 'owner');
  const sup = await page.request.post('/api/suppliers', { headers: SAME_ORIGIN, data: { name: `Kota Stone ${uid}`, mobile: '9829' + uid } });
  expect(sup.status(), await sup.text()).toBeLessThan(300);

  await page.goto('/blocks');
  await page.getByRole('button', { name: /New block/ }).first().click();
  await page.locator('#f_source').selectOption('supplier');
  await page.locator('#f_rawanna').fill(`RWN-${uid}`);
  await page.locator('#f_length').fill('8');
  await page.locator('#f_width').fill('5');
  await page.locator('#f_height').fill('4');

  // a supplier block cannot be saved without its supplier
  await page.getByRole('button', { name: /^(Submit|Save)$/i }).click();
  await expect(page.getByText(/Supplier is required|Supplier.*required/i).first()).toBeVisible();
  await choose(page, 'f_supplierId', new RegExp(`Kota Stone ${uid}`));
  await page.getByRole('button', { name: /^(Submit|Save)$/i }).click();
  await expect(page.getByText(/saved/i).first()).toBeVisible();

  const blocks = await (await page.request.get(`/api/blocks?q=RWN-${uid}`)).json();
  const blockNo = blocks.data[0].blockNo;
  expect(blocks.data[0]).toMatchObject({ supplierName: `Kota Stone ${uid}`, cft: 160, stage: 'received' });

  // the search box finds it by the block number
  await page.getByPlaceholder(/search/i).first().fill(String(blockNo));
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr').first()).toContainText(`Kota Stone ${uid}`);

  // edit: the size is locked, the weight and yard location can change
  await page.locator('tbody tr').first().getByRole('button').last().click();
  await page.getByRole('menuitem', { name: /^Edit/ }).first().click();
  await expect(page.locator('#f_length')).toHaveCount(0);
  await page.locator('#f_weight').fill('12');
  await page.locator('#f_yardLocation').fill('Row 3');
  await page.getByRole('button', { name: /^(Submit|Save)$/i }).click();
  await expect(page.getByText(/saved|updated/i).first()).toBeVisible();
  const after = await (await page.request.get(`/api/blocks?blockNo=${blockNo}`)).json();
  expect(after.data[0]).toMatchObject({ weight: 12, yardLocation: 'Row 3', cft: 160 });

  // mark cut straight from the yard: the 160 CFT leaves raw stock
  const rawBefore = (await (await page.request.get('/api/stockitems?q=Raw blocks')).json()).data[0].balance;
  await page.locator('tbody tr').first().getByRole('button').last().click();
  await page.getByRole('menuitem', { name: /Mark cut/ }).first().click();
  await page.getByRole('button', { name: /^(Yes|OK|Confirm)/i }).last().click();
  await expect(page.getByText(/marked cut/i).first()).toBeVisible();
  const rawAfter = (await (await page.request.get('/api/stockitems?q=Raw blocks')).json()).data[0].balance;
  expect(rawAfter).toBe(rawBefore - 160);

  // royalty: an overdue record is flagged and "Mark paid" records today's date
  const roy = await page.request.post('/api/royalties', { headers: SAME_ORIGIN, data: { month: `${year}-01`, amount: 50000, dueDate: `${year}-02-10`, note: `r${uid}` } }); // a month of its own, so a re-run on the same database does not meet its own record
  expect(roy.status(), await roy.text()).toBeLessThan(300);
  await page.getByRole('button', { name: /^Royalty$/ }).click();
  const row = page.locator('tbody tr').filter({ hasText: `r${uid}` });
  await expect(row).toContainText(/Overdue/i);
  await row.getByRole('button').last().click();
  await page.getByRole('menuitem', { name: /Mark paid/ }).first().click();
  await page.getByRole('button', { name: /^(Yes|OK|Confirm)/i }).last().click();
  await expect(row).toContainText(/paid/i);
  await expect(row).not.toContainText(/Overdue/i);
});
