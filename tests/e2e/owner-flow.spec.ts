import { test, expect } from '@playwright/test';
import { signIn, SAME_ORIGIN } from './helpers';

// A real working path through the API as the signed-in Owner: create, read back, cancel (never delete), audit trail.
test('Owner: create a customer, find it, cancel it, and see it in the audit trail', async ({ page }) => {
  await signIn(page, 'owner');
  const name = `E2E Customer ${Date.now()}`;
  const created = await page.request.post('/api/customers', { headers: SAME_ORIGIN, data: { name, mobile: '9811111111', state: 'Madhya Pradesh' } });
  expect(created.status(), await created.text()).toBe(201);
  const body = await created.json();
  const id = body.data?._id ?? body._id;
  expect(id).toBeTruthy();

  const found = await page.request.get(`/api/customers?q=${encodeURIComponent(name)}`);
  expect(JSON.stringify(await found.json())).toContain(name);

  await page.goto('/sales');
  await page.waitForLoadState('networkidle').catch(() => undefined);

  const voided = await page.request.delete(`/api/customers/${id}`, { headers: SAME_ORIGIN, data: { reason: 'e2e cleanup' } });
  expect(voided.status(), await voided.text()).toBeLessThan(300);

  const audit = await page.request.get('/api/auditlogs?limit=20');
  expect(JSON.stringify(await audit.json())).toContain(id);
});
