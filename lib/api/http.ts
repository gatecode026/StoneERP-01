/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { brotliCompress, gzip } from 'node:zlib';
import { NextResponse } from 'next/server';

/** Drop null / undefined keys (recursively) so responses carry only data that exists. */
export function stripNulls<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripNulls) as unknown as T;
  if (v && typeof v === 'object' && !(v instanceof Date) && !(v as any)._bsontype) {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (val !== null && val !== undefined) o[k] = stripNulls(val);
    return o as T;
  }
  return v;
}

const etagOf = (body: string) => `W/"${createHash('sha1').update(body).digest('base64url').slice(0, 22)}"`;

/**
 * JSON with an ETag. A browser that already holds the same data sends If-None-Match and gets an empty 304 (no body, no
 * parsing). Responses stay `private` (per-user: scope and field permissions differ between people) and `Vary: Cookie`.
 * `maxAge` seconds of reuse without even asking the server — only for data that rarely changes (masters, settings).
 */
export function jsonWithEtag(req: Request, data: unknown, opts: { maxAge?: number; status?: number } = {}): Response {
  const body = JSON.stringify(data);
  const etag = etagOf(body);
  const headers = {
    ETag: etag,
    'Cache-Control': `private, max-age=${opts.maxAge ?? 0}, must-revalidate`,
    Vary: 'Cookie, Accept-Encoding',
  };
  const inm = req.headers.get('if-none-match');
  if (inm && inm.split(',').some((t) => t.trim() === etag || t.trim() === etag.slice(2))) return new Response(null, { status: 304, headers });
  return new Response(body, { status: opts.status ?? 200, headers: { ...headers, 'Content-Type': 'application/json' } });
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);
const MIN_COMPRESS = 1024;

/**
 * Compress a JSON response (brotli if the browser accepts it, else gzip). The framework compresses pages, but not these API
 * responses, and a 100-row list is mostly repeated key names: it shrinks by roughly 90 %. Small, empty (304) and non-JSON responses
 * pass through untouched, and a response that is already encoded is never encoded twice.
 */
export async function compressJson(req: Request, res: Response): Promise<Response> {
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json') || res.headers.has('content-encoding') || res.status === 204 || res.status === 304 || !res.body) return res;
  const accept = req.headers.get('accept-encoding') ?? '';
  const accepted = accept.split(',').map((t) => t.split(';')[0].trim().toLowerCase());
  const useBr = accepted.includes('br');
  if (!useBr && !accepted.includes('gzip')) return res;
  const raw = Buffer.from(await res.arrayBuffer());
  const headers = new Headers(res.headers);
  headers.append('Vary', 'Accept-Encoding');
  if (raw.length < MIN_COMPRESS) return new Response(raw, { status: res.status, headers });
  const body = useBr ? await brotli(raw, { params: { 1: 4 /* BROTLI_PARAM_QUALITY */ } }) : await gz(raw, { level: 5 });
  headers.set('Content-Encoding', useBr ? 'br' : 'gzip');
  headers.delete('Content-Length');
  return new Response(new Uint8Array(body), { status: res.status, headers });
}
