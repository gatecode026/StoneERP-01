import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { connect } from '../lib/db';
import { getStorage } from '../lib/storage';
import { FileObject } from '../lib/storage/files';

async function getAllFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await getAllFiles(fullPath)));
    } else if (entry.isFile() && !entry.name.endsWith('.type')) {
      files.push(fullPath);
    }
  }
  return files;
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}

async function run() {
  console.log('--- Migrating all project documents and images to ImageKit ---');
  await connect();
  const storage = getStorage();
  console.log('Active storage driver:', storage.name);
  if (storage.name !== 'imagekit') {
    throw new Error('Active storage driver is not imagekit! Check STORAGE_DRIVER / IMAGEKIT_* env vars');
  }

  const healthy = await storage.health();
  console.log('ImageKit health check:', healthy ? 'OK' : 'FAILED');
  if (!healthy) throw new Error('ImageKit health check failed');

  let uploadedCount = 0;
  let skippedCount = 0;
  let failCount = 0;

  // 1. Migrate MongoDB fileblobs
  const db = mongoose.connection.db!;
  const cols = (await db.listCollections().toArray()).map(c => c.name);
  if (cols.includes('fileblobs')) {
    console.log('\nChecking MongoDB fileblobs collection...');
    const blobs = await db.collection('fileblobs').find({}).toArray();
    console.log(`Found ${blobs.length} fileblobs in MongoDB.`);
    for (const blob of blobs) {
      const key = String(blob._id);
      const contentType = blob.contentType || 'image/jpeg';
      const body = Buffer.from(blob.body.buffer ?? blob.body);
      try {
        const exists = await storage.exists(key);
        if (exists) {
          console.log(`[ImageKit EXISTS] ${key}`);
          skippedCount++;
        } else {
          console.log(`[ImageKit UPLOADING blob] ${key} (${body.length} bytes)...`);
          await storage.put(key, body, contentType);
          uploadedCount++;
        }
      } catch (err: any) {
        console.error(`[ERROR] Failed to migrate blob ${key}:`, err.message);
        failCount++;
      }
    }
  }

  // 2. Migrate local uploads folder
  const uploadsDir = path.resolve(process.cwd(), 'uploads');
  try {
    await fs.access(uploadsDir);
    console.log('\nChecking local uploads directory:', uploadsDir);
    const localFiles = await getAllFiles(uploadsDir);
    console.log(`Found ${localFiles.length} files in local uploads directory.`);
    for (const file of localFiles) {
      // Calculate storage key from relative path (e.g. photos/2026/10/xyz.jpg)
      const rel = path.relative(uploadsDir, file).replace(/\\/g, '/');
      const key = rel;
      let contentType = getMimeType(file);
      try {
        const typeFile = file + '.type';
        const customType = await fs.readFile(typeFile, 'utf8').catch(() => null);
        if (customType) contentType = customType.trim();
      } catch {}

      try {
        const exists = await storage.exists(key);
        if (exists) {
          console.log(`[ImageKit EXISTS] ${key}`);
          skippedCount++;
        } else {
          const body = await fs.readFile(file);
          console.log(`[ImageKit UPLOADING disk file] ${key} (${body.length} bytes)...`);
          await storage.put(key, body, contentType);
          uploadedCount++;
        }
      } catch (err: any) {
        console.error(`[ERROR] Failed to upload ${key}:`, err.message);
        failCount++;
      }
    }
  } catch (err: any) {
    console.log('Local uploads folder check:', err.message);
  }

  console.log('\n--- Migration Summary ---');
  console.log(`Uploaded to ImageKit: ${uploadedCount}`);
  console.log(`Already existed in ImageKit: ${skippedCount}`);
  console.log(`Failures: ${failCount}`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
