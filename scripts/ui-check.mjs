// Visual/runtime check: opens every page at 360px as a role, records console errors, horizontal overflow, screenshots.
// usage: node scripts/ui-check.mjs [role] [outDir]
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const BASE = 'http://localhost:3000';
const role = process.argv[2] || 'owner';
const out = process.argv[3] || './shots';
fs.mkdirSync(out, { recursive: true });
const PAGES = ['/', '/employees', '/daily-report', '/attendance', '/salary', '/safety', '/performance', '/machines', '/blocks', '/yield', '/repairs', '/vehicles', '/stock', '/purchases', '/sales', '/sales/new', '/dispatch', '/complaints', '/expenses', '/cash', '/tasks', '/papers', '/audit'];
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 360, height: 740, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${page.url()} ${m.text().slice(0, 200)}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${page.url()} ${e.message.slice(0, 200)}`));
await page.setCookie(
  { name: 'vss_role', value: role, url: BASE }, { name: 'vss_name', value: role === 'worker' ? 'Ramesh Meena' : role, url: BASE },
  ...(role === 'worker' ? [{ name: 'vss_emp', value: 'E001', url: BASE }] : []),
);
for (const p of PAGES) {
  try {
    await page.goto(BASE + p, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 1800));
    const m = await page.evaluate(() => ({ sw: Math.max(document.documentElement.scrollWidth, ...[...document.querySelectorAll('main *')].filter((e) => !e.closest('.overflow-x-auto,.overflow-auto')).map((e) => Math.ceil(e.getBoundingClientRect().right))), cw: document.documentElement.clientWidth, text: document.body.innerText.slice(0, 60).replace(/\n/g, ' | ') }));
    const name = p === '/' ? 'home' : p.replace(/\//g, '_').slice(1);
    await page.screenshot({ path: `${out}/${role}-${name}.png` });
    console.log(`${m.sw > m.cw + 1 ? '⚠ OVERFLOW' : 'ok'.padEnd(10)} ${p.padEnd(16)} ${m.sw}/${m.cw}  ${m.text}`);
  } catch (e) { console.log('FAIL', p, e.message); }
}
console.log('\nErrors:', errors.length ? '\n' + [...new Set(errors)].join('\n') : 'none');
await browser.close();
