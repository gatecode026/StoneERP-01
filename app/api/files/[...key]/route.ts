/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { route } from '@/lib/api/route';
import { getEffectivePerm, teamUserIds } from '@/lib/perm/engine';
import { notFound } from '@/lib/errors';
import { getStorage, isValidKey } from '@/lib/storage';
import { FileObject } from '@/lib/storage/files';
import type { Resource } from '@/lib/perm/resources';

export const dynamic = 'force-dynamic';

/**
 * Download a stored file. The URL contains an unguessable key, but knowing it is never enough: the caller must be signed in AND
 * be allowed to view the resource the file belongs to (personal documents additionally need personal-data access).
 * With S3/R2 the browser is redirected to a short-lived signed URL; otherwise the bytes are streamed.
 */
export const GET = route({ auth: 'required' }, async (ctx) => {
  const key = (ctx.params.key as unknown as string[] | string);
  const full = Array.isArray(key) ? key.join('/') : String(key);
  if (!isValidKey(full)) throw notFound();
  const thumb = ctx.query.get('thumb') === '1';
  const baseKey = full.replace(/_t(\.[a-z0-9]+)$/i, '$1');
  const f: any = await FileObject.findById(baseKey).lean();
  if (!f) throw notFound();
  const perm = await getEffectivePerm(ctx.user!);
  const mine = String(f.uploadedById) === ctx.user!.id;
  // same row-scope rule as the records themselves: everyone (all), the uploader and their supervisor (team), only the uploader (own)
  const scope = perm.scope(f.resource as Resource, 'view') ?? perm.scope(f.resource as Resource, 'create');
  const inScope = scope === 'all' || (scope === 'team' && (await teamUserIds(ctx.user!)).includes(String(f.uploadedById)));
  const piiOk = !(f.kind === 'docs' && f.resource === 'employees') || ['read', 'write'].includes(perm.fields.pii);
  if (!(mine || (inScope && piiOk))) throw notFound(); // same answer as "no such file"
  const storage = getStorage();
  const wanted = thumb && f.thumbKey ? f.thumbKey : baseKey;
  const url = await storage.signedUrl(wanted, 300);
  const headers = { 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' };
  if (url) return NextResponse.redirect(url, { status: 302, headers });
  const obj = await storage.get(wanted);
  if (!obj) throw notFound();
  return new NextResponse(new Uint8Array(obj.body), { headers: { ...headers, 'Content-Type': obj.contentType, 'Content-Disposition': 'inline', 'Content-Length': String(obj.body.length) } });
});
