import { z } from 'zod';
import { Types } from 'mongoose';
import { isSafeImageSrc } from '../safeUrl';

// Shared building blocks for request schemas. Every schema is an ALLOW-LIST: fields not listed are dropped.
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
export const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
export const text = (max = 200) => z.string().trim().max(max);
export const req = (max = 200) => z.string().trim().min(1, 'Required').max(max);
export const num = (min = 0, max = 1e9) => z.coerce.number().finite().min(min).max(max);
export const posNum = (max = 1e9) => z.coerce.number().finite().gt(0).max(max);
export const oidStr = z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid id');
export const empCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,12}$/, 'Invalid employee code');
export const mobile = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number');
export const optMobile = z.union([mobile, z.literal('')]);
export const gstin = z.union([z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Invalid GST number'), z.literal('')]);

/** A photo is an inline raster image (until files move to object storage) or a storage key. Nothing else is accepted. */
const KEY = /^(photos|docs|selfies|signatures|voice)\/[A-Za-z0-9_\-/.]+$/;
const okPhoto = (v: string) => v === '' || isSafeImageSrc(v) || (KEY.test(v) && !(v as string).includes('..'));
export const photo = z.string().refine(okPhoto, 'Must be an image');
export const photos = (max = 8) => z.array(photo).max(max);

export const bool = z.coerce.boolean();
export const enumOf = <const T extends readonly [string, ...string[]]>(v: T) => z.enum(v);

export const MODES = ['UPI', 'Bank', 'Cash', 'Cheque'] as const;
export const PAY_BY = ['Cash', 'UPI', 'Bank'] as const;
export const GST_RATES = [0, 5, 12, 18, 28] as const;
