import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { BASE_ROLES, PRESETS } from '../roles';

function model<T>(name: string, schema: Schema<T>): Model<T> {
  return (mongoose.models[name] as Model<T>) || mongoose.model<T>(name, schema);
}

/** A person who can sign in. Username is the 10-digit mobile number. Never hard-deleted: deactivate instead. */
const userSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, match: /^[6-9]\d{9}$/ },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: BASE_ROLES, required: true },
    preset: { type: String, enum: [...PRESETS, null], default: null },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    empCode: { type: String, default: null, index: true },
    // owner-granted extra access on top of the role, e.g. [{ resource: 'documents', actions: ['view'], scope: 'all' }]
    extraAccess: {
      type: [{ _id: false, resource: { type: String, required: true }, actions: [{ type: String, enum: ['view', 'create', 'edit', 'void', 'approve', 'export'] }], scope: { type: String, enum: ['own', 'team', 'all'], default: 'all' } }],
      default: [],
    },
    active: { type: Boolean, default: true, index: true },
    mustChangePassword: { type: Boolean, default: true },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
    lang: { type: String, enum: ['en', 'hi'], default: 'hi' },
    otpEnabled: { type: Boolean, default: false },
    createdBy: { type: String, default: null },
  },
  { timestamps: true }
);
userSchema.index({ role: 1, active: 1 });

/** Server-side session. The cookie carries a random token; only its SHA-256 is stored, so a DB leak cannot be replayed. */
const sessionSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    expiresAt: { type: Date, required: true },
    absoluteExpiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, default: Date.now },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null, maxlength: 300 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
// TTL: sessions are not financial records, so they may expire out of the database.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** Fixed-window counters used by the rate limiter (also non-financial, TTL cleaned). */
const rateLimitSchema = new Schema({ _id: { type: String }, n: { type: Number, default: 0 }, expireAt: { type: Date, required: true } }, { versionKey: false });
rateLimitSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

/** One-time passwords (optional phone-OTP login / password reset). Stored hashed. */
const otpSchema = new Schema(
  {
    username: { type: String, required: true, index: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expireAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
otpSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: mongoose.Types.ObjectId };
export const User = model('User', userSchema);
export const Session = model('Session', sessionSchema);
export const RateLimit = model('RateLimit', rateLimitSchema);
export const Otp = model('Otp', otpSchema);
