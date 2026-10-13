/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { MODELS } from '../models';
import { decodeDataUrl, storeFile, type FileKind } from './files';
import { getStorage } from './index';

/** Where inline (base64) photos may still live from the demo version: resource -> fields. */
export const PHOTO_FIELDS: Record<string, { field: string; kind: FileKind; array?: boolean }[]> = {
  employees: [{ field: 'photo', kind: 'photos' }, { field: 'docAadhaar', kind: 'docs' }, { field: 'docPan', kind: 'docs' }, { field: 'docPassbook', kind: 'docs' }, { field: 'docLicense', kind: 'docs' }],
  dailyreports: [{ field: 'photos', kind: 'photos', array: true }],
  attendance: [{ field: 'selfie', kind: 'selfies' }],
  machineentries: [{ field: 'photo', kind: 'photos' }],
  stockitems: [{ field: 'photo', kind: 'photos' }],
  expenses: [{ field: 'billPhoto', kind: 'photos' }],
  purchases: [{ field: 'billPhoto', kind: 'photos' }],
  blocks: [{ field: 'photo', kind: 'photos' }, { field: 'rawannaPhoto', kind: 'photos' }],
  repairs: [{ field: 'photo', kind: 'photos' }],
  vehicles: [{ field: 'rcPhoto', kind: 'photos' }],
  documents: [{ field: 'file', kind: 'docs' }],
  dispatches: [{ field: 'photoLoaded', kind: 'photos' }, { field: 'photoCovered', kind: 'photos' }],
  complaints: [{ field: 'photos', kind: 'photos', array: true }],
  safetyrecords: [{ field: 'signature', kind: 'signatures' }, { field: 'photo', kind: 'photos' }],
  tasks: [{ field: 'donePhoto', kind: 'photos' }],
};

export type MigrationReport = { scanned: number; moved: number; failed: { resource: string; id: string; field: string; error: string }[]; bytesBefore: number; bytesAfter: number };

/**
 * Move every base64 photo out of MongoDB into object storage: upload -> read back and verify -> only then replace the field with
 * the key. Safe to re-run (already-migrated values are keys, not data URLs). `apply:false` is a dry run that only counts.
 */
export async function migratePhotos(opts: { apply: boolean; batch?: number; log?: (m: string) => void }): Promise<MigrationReport> {
  const rep: MigrationReport = { scanned: 0, moved: 0, failed: [], bytesBefore: 0, bytesAfter: 0 };
  const storage = getStorage();
  for (const [resource, fields] of Object.entries(PHOTO_FIELDS)) {
    const M = MODELS[resource];
    if (!M) continue;
    for (const f of fields) {
      const q = f.array ? { [f.field]: { $elemMatch: { $regex: /^data:/ } } } : { [f.field]: { $regex: /^data:/ } };
      const cursor = M.find(q).select(`${f.field} createdById`).lean().cursor({ batchSize: opts.batch ?? 50 });
      for await (const doc of cursor as any) {
        rep.scanned++;
        try {
          const convert = async (v: unknown) => {
            if (typeof v !== 'string' || !v.startsWith('data:')) return v;
            const { bytes } = decodeDataUrl(v);
            rep.bytesBefore += v.length;
            if (!opts.apply) return v;
            const s = await storeFile(bytes, { kind: f.kind, resource, userId: doc.createdById ?? new Types.ObjectId('000000000000000000000000'), allowPdf: f.kind === 'docs' });
            const back = await storage.get(s.key); // verify before touching the record
            if (!back || back.body.length !== s.size || createHash('sha256').update(back.body).digest('hex').length !== 64) throw new Error('verification failed');
            rep.bytesAfter += s.size;
            return s.key;
          };
          const value = f.array ? await Promise.all((doc[f.field] ?? []).map(convert)) : await convert(doc[f.field]);
          if (opts.apply) {
            const set: Record<string, unknown> = { [f.field]: value };
            if (resource === 'expenses' || resource === 'purchases') set.hasBill = true;
            await M.updateOne({ _id: doc._id }, { $set: set });
          }
          rep.moved++;
        } catch (e: any) {
          rep.failed.push({ resource, id: String(doc._id), field: f.field, error: e.message });
        }
      }
    }
    opts.log?.(`${resource}: done`);
  }
  return rep;
}
