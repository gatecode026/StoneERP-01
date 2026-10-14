import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';
import { randomInt } from 'node:crypto';

// argon2id, OWASP-recommended minimum parameters (19 MiB, 2 passes, 1 lane)
const OPTS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (plain: string) => hash(plain, OPTS);

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | null = null;
/** Burn the same CPU time as a real check when the user does not exist (stops username enumeration by timing). */
export async function burnVerify(plain: string) {
  dummy ??= hashPassword('not-a-real-password-for-timing');
  await verifyPassword(await dummy, plain);
}

const COMMON = new Set(['password', 'password1', 'password@123', '12345678', '123456789', '1234567890', 'qwerty123', 'iloveyou', 'admin123', 'welcome1', 'abc12345', '11111111', '00000000', 'vipul123', 'stone123']);

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), 'Use letters and numbers')
  .refine((p) => !COMMON.has(p.toLowerCase()), 'This password is too common');

/** The starting password the Owner types in the employee form (same idea as the import's default 123456). The person is asked to choose a strong one (passwordSchema) when they change it. */
export const initialPasswordSchema = z.string().min(6, 'Password must be at least 6 characters').max(128, 'Password is too long');

export const mobileSchema = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'));

/** A random initial password that the owner hands over once; the user must change it at first login. */
export function generatePassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const caps = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const pick = (s: string) => s[randomInt(s.length)];
  return `${pick(caps)}${pick(letters)}${pick(letters)}${pick(letters)}-${randomInt(1000, 9999)}-${pick(caps)}${pick(letters)}${pick(letters)}`;
}
