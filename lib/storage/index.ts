import { createHash, createHmac, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getEnv, isProd } from '../env';

/**
 * File storage behind one small interface so the app never cares where bytes live.
 *   local      – a folder on disk (development / tests only; refused in production)
 *   s3         – any S3-compatible bucket: AWS S3, Cloudflare R2, MinIO …  (private objects, short-lived signed URLs)
 *   cloudinary – Cloudinary (signed REST upload, private delivery)
 * Selected by STORAGE_DRIVER. The database stores only the object KEY (e.g. "photos/2026/10/<uuid>.jpg").
 */
export type Stored = { key: string; thumbKey?: string; size: number; contentType: string };
export interface StorageDriver {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
  /** A URL the browser can load directly for `ttlSec` seconds, or null when bytes must be streamed through the app. */
  signedUrl(key: string, ttlSec: number): Promise<string | null>;
  health(): Promise<boolean>;
}

const KEY_RE = /^(photos|docs|selfies|signatures|voice|logos|exports|backups)\/[A-Za-z0-9_\-/.]+$/;
export const isValidKey = (k: unknown): k is string => typeof k === 'string' && k.length < 200 && KEY_RE.test(k) && !k.includes('..') && !k.includes('//');

export function newKey(kind: string, ext = 'jpg', at = new Date()): string {
  return `${kind}/${at.getUTCFullYear()}/${String(at.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ext}`;
}
export const thumbOf = (key: string) => key.replace(/(\.[a-z0-9]+)$/i, '_t$1');

// ------------------------------------------------------------------ local
class LocalDriver implements StorageDriver {
  readonly name = 'local';
  constructor(private root: string) {}
  private p(key: string) {
    const full = path.resolve(/*turbopackIgnore: true*/ this.root, key);
    if (!full.startsWith(path.resolve(/*turbopackIgnore: true*/ this.root) + path.sep)) throw new Error('bad key');
    return full;
  }
  async put(key: string, body: Buffer, contentType: string) {
    const f = this.p(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, body);
    await fs.writeFile(f + '.type', contentType);
  }
  async get(key: string) {
    try {
      const f = this.p(key);
      const [body, type] = await Promise.all([fs.readFile(f), fs.readFile(f + '.type', 'utf8').catch(() => 'application/octet-stream')]);
      return { body, contentType: type };
    } catch { return null; }
  }
  async exists(key: string) { try { await fs.access(this.p(key)); return true; } catch { return false; } }
  async remove(key: string) { await fs.rm(this.p(key), { force: true }); await fs.rm(this.p(key) + '.type', { force: true }); }
  async signedUrl() { return null; }
  async health() { try { await fs.mkdir(this.root, { recursive: true }); return true; } catch { return false; } }
}

// ------------------------------------------------------------------ S3-compatible
class S3Driver implements StorageDriver {
  readonly name = 's3';
  private client: import('@aws-sdk/client-s3').S3Client | null = null;
  constructor(private cfg: { endpoint?: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean }) {}
  private async c() {
    if (!this.client) {
      const { S3Client } = await import('@aws-sdk/client-s3');
      this.client = new S3Client({ region: this.cfg.region, endpoint: this.cfg.endpoint || undefined, forcePathStyle: this.cfg.forcePathStyle, credentials: { accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey } });
    }
    return this.client;
  }
  async put(key: string, body: Buffer, contentType: string) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await (await this.c()).send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: 'private, max-age=86400', ServerSideEncryption: this.cfg.endpoint ? undefined : 'AES256' }));
  }
  async get(key: string) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    try {
      const r = await (await this.c()).send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return { body: Buffer.from(await r.Body!.transformToByteArray()), contentType: r.ContentType ?? 'application/octet-stream' };
    } catch { return null; }
  }
  async exists(key: string) {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    try { await (await this.c()).send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key })); return true; } catch { return false; }
  }
  async remove(key: string) {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await (await this.c()).send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }
  async signedUrl(key: string, ttlSec: number) {
    const [{ GetObjectCommand }, { getSignedUrl }] = await Promise.all([import('@aws-sdk/client-s3'), import('@aws-sdk/s3-request-presigner')]);
    return getSignedUrl(await this.c(), new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }), { expiresIn: ttlSec });
  }
  async health() {
    const { HeadBucketCommand } = await import('@aws-sdk/client-s3');
    try { await (await this.c()).send(new HeadBucketCommand({ Bucket: this.cfg.bucket })); return true; } catch { return false; }
  }
}

// ------------------------------------------------------------------ Cloudinary (signed REST, no SDK)
class CloudinaryDriver implements StorageDriver {
  readonly name = 'cloudinary';
  constructor(private cfg: { cloud: string; key: string; secret: string }) {}
  private sign(params: Record<string, string | number>) {
    const s = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
    return createHash('sha1').update(s + this.cfg.secret).digest('hex');
  }
  async put(key: string, body: Buffer, contentType: string) {
    const ts = Math.floor(Date.now() / 1000);
    const publicId = key.replace(/\.[a-z0-9]+$/i, '');
    const params = { public_id: publicId, timestamp: ts, type: 'authenticated' };
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(body)], { type: contentType }), path.basename(key));
    for (const [k, v] of Object.entries(params)) form.set(k, String(v));
    form.set('api_key', this.cfg.key);
    form.set('signature', this.sign(params));
    const r = await fetch(`https://api.cloudinary.com/v1_1/${this.cfg.cloud}/auto/upload`, { method: 'POST', body: form });
    if (!r.ok) throw new Error(`cloudinary upload failed (${r.status})`);
  }
  async get(key: string) {
    const url = await this.signedUrl(key, 300);
    if (!url) return null;
    const r = await fetch(url);
    if (!r.ok) return null;
    return { body: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') ?? 'application/octet-stream' };
  }
  async exists(key: string) { return (await this.get(key)) !== null; }
  async remove(key: string) {
    const ts = Math.floor(Date.now() / 1000);
    const params = { public_id: key.replace(/\.[a-z0-9]+$/i, ''), timestamp: ts, type: 'authenticated' };
    const form = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), api_key: this.cfg.key, signature: this.sign(params) });
    await fetch(`https://api.cloudinary.com/v1_1/${this.cfg.cloud}/image/destroy`, { method: 'POST', body: form });
  }
  async signedUrl(key: string, ttlSec: number) {
    // authenticated delivery URL: /image/authenticated/s--SIG--/<public_id>.<ext>
    const ext = path.extname(key);
    const id = key.slice(0, key.length - ext.length);
    void ttlSec; // Cloudinary signatures do not expire; the app only hands the URL to signed-in users who may see the file
    const sig = createHash('sha1').update(id + this.cfg.secret).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').slice(0, 8);
    return `https://res.cloudinary.com/${this.cfg.cloud}/image/authenticated/s--${sig}--/${id}${ext}`;
  }
  async health() { return Boolean(this.cfg.cloud && this.cfg.key); }
}

let driver: StorageDriver | null = null;
export function getStorage(): StorageDriver {
  if (driver) return driver;
  const e = process.env;
  const kind = e.STORAGE_DRIVER ?? (isProd() ? '' : 'local');
  if (kind === 'local') {
    if (isProd()) throw new Error('STORAGE_DRIVER=local is not allowed in production');
    driver = new LocalDriver(path.resolve(/*turbopackIgnore: true*/ e.STORAGE_LOCAL_DIR ?? 'uploads'));
  } else if (kind === 's3') {
    for (const k of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) if (!e[k]) throw new Error(`${k} is required when STORAGE_DRIVER=s3`);
    driver = new S3Driver({ endpoint: e.S3_ENDPOINT, region: e.S3_REGION ?? 'auto', bucket: e.S3_BUCKET!, accessKeyId: e.S3_ACCESS_KEY_ID!, secretAccessKey: e.S3_SECRET_ACCESS_KEY!, forcePathStyle: e.S3_FORCE_PATH_STYLE === 'yes' });
  } else if (kind === 'cloudinary') {
    for (const k of ['CLOUDINARY_CLOUD', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) if (!e[k]) throw new Error(`${k} is required when STORAGE_DRIVER=cloudinary`);
    driver = new CloudinaryDriver({ cloud: e.CLOUDINARY_CLOUD!, key: e.CLOUDINARY_API_KEY!, secret: e.CLOUDINARY_API_SECRET! });
  } else {
    throw new Error('Set STORAGE_DRIVER to s3, cloudinary (or local for development)');
  }
  return driver;
}
export function setStorageForTests(d: StorageDriver | null) { driver = d; }
void getEnv; void createHmac;
