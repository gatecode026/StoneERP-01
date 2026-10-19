import mongoose, { Schema } from 'mongoose';
import { connect } from '../db';
import type { StorageDriver } from './index';

/** One document per stored object (the photo or PDF itself). `_id` is the storage key, like every other driver. */
const blobSchema = new Schema(
  { _id: { type: String }, body: { type: Buffer, required: true }, contentType: { type: String, required: true }, size: Number },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);
const FileBlob = mongoose.models.FileBlob || mongoose.model('FileBlob', blobSchema, 'fileblobs');

/**
 * Files kept in the app's own MongoDB. Images are re-encoded to a small JPEG before they arrive (lib/storage/files.ts) and PDFs
 * are capped at 10 MB, so every object fits a document (16 MB) with room to spare. Downloads are streamed through the app, which
 * checks who may see the file first (app/api/files/[...key]).
 */
export class MongoDriver implements StorageDriver {
  readonly name = 'mongo';
  async put(key: string, body: Buffer, contentType: string) {
    await connect();
    await FileBlob.replaceOne({ _id: key }, { _id: key, body, contentType, size: body.length }, { upsert: true });
  }
  async get(key: string) {
    await connect();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d: any = await FileBlob.findById(key).lean();
    if (!d) return null;
    return { body: Buffer.from(d.body.buffer ?? d.body), contentType: d.contentType };
  }
  async exists(key: string) {
    await connect();
    return (await FileBlob.countDocuments({ _id: key })) > 0;
  }
  async remove(key: string) {
    await connect();
    await FileBlob.deleteOne({ _id: key });
  }
  async signedUrl() { return null; }
  async health() {
    try { await connect(); await mongoose.connection.db!.command({ ping: 1 }); return true; } catch { return false; }
  }
}
