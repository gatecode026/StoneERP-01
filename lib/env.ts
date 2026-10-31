import { z } from 'zod';

// One place that reads process.env. Fails fast in production when something required is missing.
const bool = z.enum(['yes', 'no', 'true', 'false', '1', '0']).transform((v) => ['yes', 'true', '1'].includes(v));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MONGODB_URI: z.string().min(10, 'MONGODB_URI is required'),
  MONGODB_DB: z.string().optional(),
  MONGO_MAX_POOL: z.coerce.number().int().min(1).max(200).default(20),
  MONGO_READ_PREFERENCE: z.enum(['primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest']).default('primary'),
  MONGO_REPORT_READ: z.enum(['primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest']).default('primary'), // where report/analytics reads go (use secondaryPreferred on Atlas)
  MONGO_AUTO_INDEX: bool.optional(),
  MONGO_DNS_FALLBACK: bool.default(false), // dev-only workaround for ISPs that refuse SRV lookups
  ALLOW_NO_TXN: bool.default(false), // dev-only: run on a standalone mongod without transactions
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  FIELD_ENCRYPTION_KEY: z.string().optional(), // base64, 32 bytes
  APP_ORIGIN: z.string().optional(), // comma separated list of allowed Origins for mutating requests
  OTP_PROVIDER: z.enum(['none', 'console', 'msg91', 'twilio']).default('none'),
  OTP_API_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(14), // nightly backups older than this are removed from storage
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  STORAGE_DRIVER: z.enum(['mongo', 's3', 'cloudinary', 'imagekit', 'local']).optional(),
  IMAGEKIT_URL_ENDPOINT: z.string().optional(),
  IMAGEKIT_PRIVATE_KEY: z.string().optional(),
  IMAGEKIT_PUBLIC_KEY: z.string().optional(),
  IMAGEKIT_FOLDER: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(), // the Owner's dashboard assistant; without it the assistant says it is not set up
  OPENROUTER_MODEL: z.string().default('nvidia/nemotron-3.5-super-vl:free'),
});

export type Env = z.infer<typeof schema>;

export const DEV_SESSION_SECRET = 'dev-only-session-secret-change-me-0123456789';
let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const raw: Record<string, string | undefined> = { ...process.env };
  const nodeEnv = raw.NODE_ENV ?? 'development';
  if (nodeEnv !== 'production') raw.SESSION_SECRET ??= DEV_SESSION_SECRET;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${msg}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    const problems: string[] = [];
    if (env.SESSION_SECRET === DEV_SESSION_SECRET) problems.push('SESSION_SECRET must not be the development default');
    if (!env.FIELD_ENCRYPTION_KEY || Buffer.from(env.FIELD_ENCRYPTION_KEY, 'base64').length !== 32) problems.push('FIELD_ENCRYPTION_KEY must be base64 of 32 bytes');
    if (env.ALLOW_NO_TXN) problems.push('ALLOW_NO_TXN must not be enabled in production');
    if (env.MONGO_DNS_FALLBACK) problems.push('MONGO_DNS_FALLBACK must not be enabled in production');
    if (problems.length) throw new Error(`Invalid production environment: ${problems.join('; ')}`);
  }
  cached = env;
  return env;
}

export const isProd = () => process.env.NODE_ENV === 'production';
/** test helper */
export function resetEnvCache() {
  cached = null;
}
