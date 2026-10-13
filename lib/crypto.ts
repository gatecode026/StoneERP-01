import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { getEnv } from './env';

// Field-level encryption for sensitive values (bank account, Aadhaar, PAN): AES-256-GCM, random 96-bit IV per value.
// Stored as  enc:v1:<iv>.<tag>.<ciphertext>  (base64url). Losing FIELD_ENCRYPTION_KEY makes these values unrecoverable.
const PREFIX = 'enc:v1:';

function key(): Buffer {
  const k = getEnv().FIELD_ENCRYPTION_KEY;
  if (!k) {
    // development/test only (env.ts makes production fail without the key)
    return createHmac('sha256', getEnv().SESSION_SECRET).update('field-encryption-dev').digest();
  }
  return Buffer.from(k, 'base64');
}

export const isEncrypted = (v: unknown): v is string => typeof v === 'string' && v.startsWith(PREFIX);

export function encryptField(plain: string | null | undefined): string {
  if (plain === null || plain === undefined || plain === '') return '';
  if (isEncrypted(plain)) return plain;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `${PREFIX}${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`;
}

export function decryptField(v: string | null | undefined): string {
  if (!v) return '';
  if (!isEncrypted(v)) return v; // legacy plaintext value
  const [iv, tag, ct] = v.slice(PREFIX.length).split('.');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

/** "XXXX-XXXX-1234" for Aadhaar, "XXXXXX1234" for accounts: only the last 4 characters are ever shown. */
export function maskTail(plain: string, groups: 'aadhaar' | 'plain' = 'plain'): string {
  const s = String(plain ?? '').replace(/\s|-/g, '');
  if (!s) return '';
  const last = s.slice(-4);
  return groups === 'aadhaar' ? `XXXX-XXXX-${last}` : `${'X'.repeat(Math.max(0, s.length - 4))}${last}`;
}
