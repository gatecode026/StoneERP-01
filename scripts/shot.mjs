import puppeteer from 'puppeteer-core';
const [,, role, path, file, w = '360', h = '800', full = '0', click = ''] = process.argv;
const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new' });
const p = await b.newPage();
await p.setViewport({ width: +w, height: +h, isMobile: +w < 500, hasTouch: +w < 500 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 200)));
await p.setCookie({ name: 'vss_role', value: role, url: 'http://localhost:3000' }, { name: 'vss_name', value: role === 'worker' ? 'Ramesh Meena' : role, url: 'http://localhost:3000' }, ...(role === 'worker' ? [{ name: 'vss_emp', value: 'E001', url: 'http://localhost:3000' }] : []));
await p.goto('http://localhost:3000' + path, { waitUntil: 'networkidle0', timeout: 90000 });
await new Promise((r) => setTimeout(r, 2500));
if (click) { await p.evaluate((t) => { const el = [...document.querySelectorAll('button,a')].find((x) => x.innerText.trim().includes(t)); el && el.click(); }, click); await new Promise((r) => setTimeout(r, 1500)); }
await p.screenshot({ path: file, fullPage: full === '1' });
console.log('errors:', errs.length ? errs.join(' | ') : 'none');
await b.close();
