import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/client';

const reply = (status: number, error: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } })));
afterEach(() => vi.unstubAllGlobals());

describe('what the screen says when the server refuses a form', () => {
  it('names the field and the reason instead of "Some fields are not valid"', async () => {
    reply(400, { code: 'VALIDATION', message: 'Some fields are not valid', details: [
      { path: 'login.password', message: 'Password must be at least 6 characters' },
      { path: 'mobile', message: 'Enter a 10-digit mobile number' },
      { path: 'fatherName', message: 'Too long' },
    ] });
    await expect(api('/api/employees', { method: 'POST', body: {} })).rejects.toThrow('Password must be at least 6 characters · Enter a 10-digit mobile number · Father name: Too long');
  });

  it('does not repeat the same reason, and says how many more there are', async () => {
    reply(400, { code: 'VALIDATION', message: 'Some fields are not valid', details: [
      { path: 'login.password', message: 'Password must be at least 8 characters' }, { path: 'login.password', message: 'Password must be at least 8 characters' },
      { path: 'address', message: 'Too long' }, { path: 'site', message: 'Pick one' }, { path: 'rate', message: 'Must be a number' },
    ] });
    await expect(api('/api/x', { method: 'POST', body: {} })).rejects.toThrow('Password must be at least 8 characters · Address: Too long · Site: Pick one · +1 more');
  });

  it('other errors keep the server message, and a confirmable one keeps its flag', async () => {
    reply(409, { code: 'CONFIRM_REQUIRED', message: 'Save anyway?', details: { confirmable: true } });
    await expect(api('/api/x', { method: 'POST', body: {} })).rejects.toMatchObject({ message: 'Save anyway?', status: 409, data: { confirmable: true } });
  });
});
