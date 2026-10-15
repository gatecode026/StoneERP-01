import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test.describe('what each job may open', () => {
  test('Worker: no settings, no books, no purchases, and the API agrees', async ({ page }) => {
    await signIn(page, 'worker');
    for (const path of ['/settings', '/cash', '/audit', '/purchases']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      // either sent away, or shown a "no access" message, never the real screen
      const body = (await page.locator('body').innerText()).toLowerCase();
      const gone = !new URL(page.url()).pathname.startsWith(path);
      expect(gone || /no access|not allowed|permission|not available|अनुमति नहीं/.test(body), `${path} must not open for a Worker`).toBe(true);
    }
    for (const url of ['/api/cash', '/api/settings', '/api/auditlogs', '/api/salary']) {
      const r = await page.request.get(url);
      expect([401, 403, 404], `${url} gave ${r.status()}`).toContain(r.status());
    }
  });

  test('Supervisor: cannot read salaries, cannot open settings', async ({ page }) => {
    await signIn(page, 'supervisor');
    const sal = await page.request.get('/api/salary');
    expect([401, 403, 404]).toContain(sal.status());
    const set = await page.request.get('/api/settings');
    expect([401, 403, 404]).toContain(set.status());
  });

  test('a write from another website is refused (CSRF)', async ({ page }) => {
    await signIn(page, 'owner');
    const r = await page.request.post('/api/customers', { headers: { origin: 'https://evil.example' }, data: { name: 'x' } });
    expect(r.status()).toBeGreaterThanOrEqual(400);
  });
});
