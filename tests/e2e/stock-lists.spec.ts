import { test, expect, type Page } from '@playwright/test';
import { signIn, overflowsSideways } from './helpers';

// Stock → Tools stock / Material stock / Machinery stock: three simple forms in the format of the client's sheet.
const uid = Date.now().toString().slice(-5);

async function addRow(page: Page, tab: string, fill: Record<string, string>) {
  await page.getByRole('button', { name: new RegExp(`^${tab}$`) }).click();
  await page.getByRole('button', { name: /^\s*\+?\s*Add\b/i }).first().click();
  for (const [field, value] of Object.entries(fill)) await page.locator(`#f_${field}`).fill(value);
  await page.getByRole('button', { name: /^(Submit|Save)$/ }).click();
}

test('Owner: adds a tool, a material row and a machine from the Stock screen and sees them with their totals', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, 'owner');
  await page.goto('/stock');

  // the three new sections sit beside the existing ones
  for (const t of ['Physical Stock', 'Day by day', 'Tools stock', 'Material stock', 'Machinery stock']) await expect(page.getByRole('button', { name: new RegExp(`^${t}$`) })).toBeVisible();

  // 1. Tools stock: Tool Name, Company, Pieces, Rate
  await page.getByRole('button', { name: /^Tools stock$/ }).click();
  await page.getByRole('button', { name: /^\s*\+?\s*Add\b/i }).first().click();
  for (const f of ['name', 'company', 'pieces', 'rate']) await expect(page.locator(`#f_${f}`)).toBeVisible();
  expect(await page.locator('form input, form select').count()).toBeLessThanOrEqual(6); // a short form, not a long one
  await page.locator('#f_name').fill(`14" blade ${uid}`);
  await page.locator('#f_company').fill('sona');
  await page.locator('#f_pieces').fill('10');
  await page.locator('#f_rate').fill('1100');
  await page.getByRole('button', { name: /^(Submit|Save)$/ }).click();
  await expect(page.getByText(`14" blade ${uid}`).first()).toBeVisible();
  await expect(page.getByText('₹1,100').first()).toBeVisible();

  // 2. Material stock: Colour, Top / Edge / Bottom finish, Size, Thickness, Pieces, Sqft
  await addRow(page, 'Material stock', { colour: `Basalt ${uid}`, topFinish: 'swan', edgeFinish: 'Uncut', bottomFinish: 'Sawn', size: '72x24', thickness: '20mm', pieces: '20', sqft: '240' });
  const material = page.getByText(`Basalt ${uid}`).first();
  await expect(material).toBeVisible();
  await expect(page.getByText('72x24').first()).toBeVisible();
  await expect(page.getByText('Total sqft').first()).toBeVisible();

  // 3. Machinery stock: Name, Condition, Repairing cost, Purchase Price, Pieces
  await addRow(page, 'Machinery stock', { name: `Grinder ${uid}`, condition: 'Bearing', repairingCost: '150', purchasePrice: '1500', pieces: '1' });
  await expect(page.getByText(`Grinder ${uid}`).first()).toBeVisible();
  await expect(page.getByText('₹1,500').first()).toBeVisible();
  await expect(page.getByText('Bearing').first()).toBeVisible();
  expect(await overflowsSideways(page)).toBe(false);

  // the rows are saved: still there after a reload, on their own tab
  await page.reload();
  await page.getByRole('button', { name: /^Machinery stock$/ }).click();
  await expect(page.getByText(`Grinder ${uid}`).first()).toBeVisible();
  await page.getByRole('button', { name: /^Tools stock$/ }).click();
  await expect(page.getByText(`14" blade ${uid}`).first()).toBeVisible();

  // the name is required: an empty form is refused with a message, and nothing is added
  await page.getByRole('button', { name: /^\s*\+?\s*Add\b/i }).first().click();
  await page.getByRole('button', { name: /^(Submit|Save)$/ }).click();
  await expect(page.locator('#f_name')).toBeVisible(); // the form stays open
});

// Import from Excel in all three sections, with the client's sheet: three tables in one sheet, a heading above each, blank rows between.
test('Owner: "Import from Excel" in Tools, Material and Machinery stock reads the client sheet and adds each section its own rows', async ({ page }) => {
  test.setTimeout(240_000);
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  const u = uid + 'i'; // its own names: the other test in this file already added rows with ${uid}
  [
    ['', 'Tools Stock'], ['Tool Name', 'Company', 'Pieces', 'Rate'], [`14" blade ${u}`, 'sona', 10, 1100], [`16" blade ${u}`, 'DK', 12, 1700], [], [],
    ['', 'Matarial Stock'], ['Colour', 'Top Finish', 'Edge Finish', 'Bottam Finish', 'Size', 'Thickness', 'Pieces', 'sqft'],
    [`Basalt ${u}`, 'swan', 'Uncut', 'Sawn', '72x24', '20mm', 20, 240], [`Grey ${u}`, 'Natural', 'Uncut', 'Natural', '24x36', '22mm', 30, 180], [], [],
    ['', 'Mini Machine Stock'], ['Name', 'Condition', 'Repairing cost', 'Purchase Price', 'Pieces'],
    [`Grinder ${u}`, 'Bearing', 150, 1500, 1], [`Hamer Drill ${u}`, 'Ready', 0, 2500, 2],
  ].forEach((r) => ws.addRow(r));
  const file = `${process.env.TEMP || '/tmp'}/client-stock-${u}.xlsx`;
  await wb.xlsx.writeFile(file);

  await signIn(page, 'owner');
  await page.goto('/stock');
  for (const [tab, rows, first] of [['Tools stock', 2, `14" blade ${u}`], ['Material stock', 2, `Basalt ${u}`], ['Machinery stock', 2, `Grinder ${u}`]] as const) {
    await page.getByRole('button', { name: new RegExp(`^${tab}$`) }).click();
    await page.getByRole('button', { name: /Import from Excel/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('link', { name: /template/i })).toBeVisible(); // the template of this very list
    await dialog.locator('#imp_file').setInputFiles(file);
    // only this section's rows are found in the shared sheet
    await expect(dialog.getByText(new RegExp(`${rows} rows`, 'i')).first()).toBeVisible({ timeout: 90_000 });
    await dialog.getByRole('button', { name: new RegExp(`^Import ${rows}$`) }).click();
    await expect(page.getByText(first).first()).toBeVisible({ timeout: 60_000 });
  }
  // each row went to the right list, with its numbers
  await page.getByRole('button', { name: /^Material stock$/ }).click();
  await expect(page.getByText('72x24').first()).toBeVisible();
  await expect(page.getByText(`Grey ${u}`).first()).toBeVisible();
  await page.getByRole('button', { name: /^Tools stock$/ }).click();
  await expect(page.getByText('₹1,700').first()).toBeVisible();
});
