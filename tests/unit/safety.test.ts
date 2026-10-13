import { describe, expect, it } from 'vitest';
import { isSafeImageSrc } from '@/lib/safeUrl';
import { assertSafeKeys } from '@/lib/api/route';
import { mobileSchema, passwordSchema } from '@/lib/auth/password';
import { getEnv, resetEnvCache } from '@/lib/env';

describe('image allow-list (audit S-05)', () => {
  it('accepts inline raster images and local file urls', () => {
    expect(isSafeImageSrc('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBe(true);
    expect(isSafeImageSrc('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isSafeImageSrc('/api/files/photos/2026/abc.jpg')).toBe(true);
  });
  it('rejects script/markup vectors', () => {
    for (const bad of [
      'javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/svg+xml;base64,PHN2Zz4=',
      'x" onerror="alert(1)', 'https://evil.example/x.png', '/api/files/../../etc/passwd', '', null, 42,
      'data:image/png;base64,AAA" onerror="alert(1)',
    ]) expect(isSafeImageSrc(bad)).toBe(false);
  });
});

describe('operator-injection guard (audit S-09)', () => {
  it('rejects $-operators and dotted keys at any depth', () => {
    expect(() => assertSafeKeys({ a: 1, b: { c: [{ d: 2 }] } })).not.toThrow();
    expect(() => assertSafeKeys({ $where: '1' })).toThrow();
    expect(() => assertSafeKeys({ a: { $ne: 1 } })).toThrow();
    expect(() => assertSafeKeys({ 'a.b': 1 })).toThrow();
    expect(() => assertSafeKeys({ a: [{ $gt: 1 }] })).toThrow();
  });
});

describe('credentials policy', () => {
  it('normalises Indian mobile numbers', () => {
    expect(mobileSchema.parse('98290 12345')).toBe('9829012345');
    expect(mobileSchema.parse('+919829012345')).toBe('9829012345');
    expect(mobileSchema.parse('09829012345')).toBe('9829012345');
    expect(mobileSchema.safeParse('12345').success).toBe(false);
    expect(mobileSchema.safeParse('5829012345').success).toBe(false);
  });
  it('enforces password strength', () => {
    expect(passwordSchema.safeParse('short1').success).toBe(false);
    expect(passwordSchema.safeParse('allletters').success).toBe(false);
    expect(passwordSchema.safeParse('password1').success).toBe(false);
    expect(passwordSchema.safeParse('Stone-4521-ok').success).toBe(true);
  });
});

describe('environment validation (fail fast)', () => {
  it('refuses a production start without secrets', () => {
    const keep = { ...process.env };
    try {
      Object.assign(process.env, { NODE_ENV: 'production', MONGODB_URI: 'mongodb://localhost/x' });
      delete process.env.SESSION_SECRET;
      delete process.env.FIELD_ENCRYPTION_KEY;
      resetEnvCache();
      expect(() => getEnv()).toThrow(/SESSION_SECRET/);
      process.env.SESSION_SECRET = 'x'.repeat(40);
      resetEnvCache();
      expect(() => getEnv()).toThrow(/FIELD_ENCRYPTION_KEY/);
      process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
      resetEnvCache();
      expect(getEnv().NODE_ENV).toBe('production');
      process.env.ALLOW_NO_TXN = 'yes';
      resetEnvCache();
      expect(() => getEnv()).toThrow(/ALLOW_NO_TXN/);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
      Object.assign(process.env, keep);
      resetEnvCache();
    }
  });
});
