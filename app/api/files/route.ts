import { NextResponse } from 'next/server';
import { route } from '@/lib/api/route';
import { getEffectivePerm } from '@/lib/perm/engine';
import { RESOURCES, isResource } from '@/lib/perm/resources';
import { badRequest, forbidden } from '@/lib/errors';
import { KINDS, MAX_IMAGE_BYTES, storeFile, type FileKind } from '@/lib/storage/files';

export const dynamic = 'force-dynamic';

/**
 * Direct upload (multipart/form-data: file, resource, kind). Used for PDFs and by clients that upload before saving.
 * The caller must be allowed to add or edit records of `resource`. Content is verified (not the claimed type), images are
 * re-encoded without EXIF location data, and a thumbnail is made.
 */
export const POST = route({ auth: 'required' }, async (ctx) => {
  const len = Number(ctx.req.headers.get('content-length') ?? 0);
  if (len > MAX_IMAGE_BYTES + 100_000) throw badRequest('File is too large');
  const form = await ctx.req.formData();
  const file = form.get('file');
  const resource = String(form.get('resource') ?? '');
  const kind = String(form.get('kind') ?? 'photos') as FileKind;
  if (!(file instanceof File)) throw badRequest('Choose a file');
  if (!isResource(resource) || !(KINDS as readonly string[]).includes(kind)) throw badRequest('Unknown upload target');
  const perm = await getEffectivePerm(ctx.user!);
  if (!perm.can(resource, 'create') && !perm.can(resource, 'edit')) throw forbidden();
  void RESOURCES;
  const bytes = Buffer.from(await file.arrayBuffer());
  const stored = await storeFile(bytes, { kind, resource, userId: ctx.user!.id, allowPdf: kind === 'docs' });
  return NextResponse.json(stored, { status: 201 });
});
