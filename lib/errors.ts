import { ZodError } from 'zod';
import { NextResponse } from 'next/server';
import { logger } from './logger';

export type ErrorBody = { error: { code: string; message: string; details?: unknown; requestId?: string } };

export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Please sign in') => new AppError(401, 'UNAUTHENTICATED', msg);
export const forbidden = (msg = 'You do not have access to this') => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Not found') => new AppError(404, 'NOT_FOUND', msg);
export const conflict = (msg: string, details?: unknown) => new AppError(409, 'CONFLICT', msg, details);
/** A warning the user may override by repeating the request with `_confirmed: true` */
export const confirmable = (msg: string) => new AppError(409, 'CONFIRM_REQUIRED', msg, { confirmable: true });
export const tooMany = (retryAfterSec: number) => new AppError(429, 'RATE_LIMITED', 'Too many requests. Please wait and try again.', { retryAfterSec });
export const payloadTooLarge = (maxBytes: number) => new AppError(413, 'PAYLOAD_TOO_LARGE', `Request is larger than ${Math.round(maxBytes / 1024)} KB`);

/** Map any thrown value to a safe HTTP response. Internal messages are logged, never returned. */
export function toResponse(e: unknown, requestId?: string): NextResponse<ErrorBody> {
  let status = 500;
  let code = 'INTERNAL';
  let message = 'Something went wrong. Please try again.';
  let details: unknown;
  const err = e as { name?: string; code?: number; keyPattern?: Record<string, unknown> } | undefined;

  if (e instanceof AppError) {
    status = e.status; code = e.code; message = e.message; details = e.details;
  } else if (e instanceof ZodError) {
    status = 400; code = 'VALIDATION';
    message = 'Some fields are not valid';
    details = e.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err?.code === 11000) {
    status = 409; code = 'DUPLICATE';
    message = 'This value already exists';
    details = { fields: Object.keys(err.keyPattern ?? {}) };
  } else if (err?.name === 'CastError') {
    console.error('CastError occurred:', { path: (err as any)?.path, value: (err as any)?.value, kind: (err as any)?.kind, message: (err as any)?.message });
    status = 400; code = 'BAD_REQUEST'; message = (err as any)?.path ? `Invalid value for ${(err as any).path}` : 'Invalid value';
  } else if (err?.name === 'ValidationError') {
    status = 400; code = 'VALIDATION'; message = 'Some fields are not valid';
  } else {
    logger.error({ err: e, requestId }, 'unhandled error');
  }
  const res = NextResponse.json<ErrorBody>({ error: { code, message, details, requestId } }, { status });
  if (code === 'RATE_LIMITED' && details && typeof details === 'object' && 'retryAfterSec' in details) {
    res.headers.set('Retry-After', String((details as { retryAfterSec: number }).retryAfterSec));
  }
  return res;
}
