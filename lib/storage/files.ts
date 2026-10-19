/* eslint-disable @typescript-eslint/no-explicit-any */
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import mongoose, { Schema } from 'mongoose';
import { badRequest, payloadTooLarge } from '../errors';
import { getStorage, newKey, thumbOf, type Stored } from './index';
import { trackQueries } from '../api/reqctx';

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // what a phone camera can send before we shrink it
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 60_000_000; // decompression-bomb guard
export const KINDS = ['photos', 'docs', 'selfies', 'signatures', 'logos'] as const;
export type FileKind = (typeof KINDS)[number];

/** One row per stored object: who uploaded it and which resource it belongs to, so downloads can be permission-checked. */
const fileSchema = new Schema(
  {
    _id: { type: String }, // = key
    kind: { type: String, enum: KINDS, required: true },
    resource: { type: String, required: true },
    uploadedById: { type: Schema.Types.ObjectId, required: true },
    contentType: String,
    size: Number,
    thumbKey: String,
    sha256: String,
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);
fileSchema.index({ uploadedById: 1, createdAt: -1 });
fileSchema.plugin(trackQueries);
export const FileObject = mongoose.models.FileObject || mongoose.model('FileObject', fileSchema);

const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i;

/** Decode "data:image/jpeg;base64,…" into bytes (size-checked before decoding). */
export function decodeDataUrl(v: string): { bytes: Buffer; mime: string } {
  const m = DATA_URL.exec(v);
  if (!m) throw badRequest('Not a valid file');
  if (m[2].length > MAX_IMAGE_BYTES * 1.4) throw payloadTooLarge(MAX_IMAGE_BYTES);
  return { bytes: Buffer.from(m[2], 'base64'), mime: m[1].toLowerCase() };
}

/** Validate by content (never by the claimed type), strip metadata (EXIF GPS), re-encode to a web-friendly JPEG + thumbnail. */
export async function processImage(input: Buffer) {
  if (input.length > MAX_IMAGE_BYTES) throw payloadTooLarge(MAX_IMAGE_BYTES);
  let meta;
  try { meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata(); } catch { throw badRequest('This file is not a valid image'); }
  if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) throw badRequest('Only JPEG, PNG or WebP photos are allowed');
  const base = sharp(input, { limitInputPixels: MAX_PIXELS }).rotate().flatten({ background: '#ffffff' });
  try {
    const [full, thumb] = await Promise.all([
      base.clone().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer(),
      base.clone().resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer(),
    ]);
    return { full, thumb };
  } catch {
    // the header is fine but the picture itself is cut short or damaged (a dropped upload): the person is told, instead of "something went wrong"
    throw badRequest('This photo is damaged or was not sent completely. Please choose it again');
  }
}

const isPdf = (b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-';

/** Store an uploaded file (image or, for documents, PDF) and register it for permission-checked download. */
export async function storeFile(bytes: Buffer, o: { kind: FileKind; resource: string; userId: unknown; allowPdf?: boolean }): Promise<Stored> {
  const storage = getStorage();
  if (isPdf(bytes)) {
    if (!o.allowPdf) throw badRequest('Only photos are allowed here');
    if (bytes.length > MAX_PDF_BYTES) throw payloadTooLarge(MAX_PDF_BYTES);
    const key = newKey(o.kind, 'pdf');
    await storage.put(key, bytes, 'application/pdf');
    await FileObject.create({ _id: key, kind: o.kind, resource: o.resource, uploadedById: o.userId, contentType: 'application/pdf', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    return { key, size: bytes.length, contentType: 'application/pdf' };
  }
  const { full, thumb } = await processImage(bytes);
  const key = newKey(o.kind, 'jpg');
  const thumbKey = thumbOf(key);
  await Promise.all([storage.put(key, full, 'image/jpeg'), storage.put(thumbKey, thumb, 'image/jpeg')]);
  await FileObject.create({ _id: key, kind: o.kind, resource: o.resource, uploadedById: o.userId, contentType: 'image/jpeg', size: full.length, thumbKey, sha256: createHash('sha256').update(full).digest('hex') });
  return { key, thumbKey, size: full.length, contentType: 'image/jpeg' };
}

// ---- turning inline photos in a request body into stored files
const KIND_BY_FIELD: Record<string, FileKind> = {
  photo: 'photos', photos: 'photos', billPhoto: 'photos', rawannaPhoto: 'photos', donePhoto: 'photos', photoLoaded: 'photos', photoCovered: 'photos', rcPhoto: 'photos',
  selfie: 'selfies', signature: 'signatures', file: 'docs', documents: 'docs', docAadhaar: 'docs', docPan: 'docs', docPassbook: 'docs', docLicense: 'docs',
};

/** Replaces every inline data-URL in the known photo fields with a stored key. After this the database never holds base64. */
export async function ingestPhotos(body: Record<string, any>, resource: string, userId: unknown): Promise<number> {
  let n = 0;
  const one = async (field: string, v: unknown) => {
    if (typeof v !== 'string' || !v.startsWith('data:')) return v;
    const { bytes } = decodeDataUrl(v);
    const kind = KIND_BY_FIELD[field];
    const s = await storeFile(bytes, { kind, resource, userId, allowPdf: kind === 'docs' });
    n++;
    return s.key;
  };
  for (const field of Object.keys(body)) {
    if (!KIND_BY_FIELD[field]) continue;
    const v = body[field];
    body[field] = Array.isArray(v) ? await Promise.all(v.map((x) => one(field, x))) : await one(field, v);
  }
  return n;
}
