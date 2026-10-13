import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { Otp, User } from '../models/auth';
import { connect } from '../db';
import { getEnv } from '../env';
import { AppError } from '../errors';
import { logger } from '../logger';
import { mobileSchema } from './password';
import { createSession } from './session';
import { enforce } from './ratelimit';
import type { LoginMeta } from './login';

// Optional phone-OTP sign-in. Disabled (404) unless OTP_PROVIDER is configured AND the user has otpEnabled.
// Providers are plain HTTPS calls so no SDK is needed; `console` logs the code for local development.
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const otpEnabled = () => getEnv().OTP_PROVIDER !== 'none';

async function send(mobile: string, code: string) {
  const env = getEnv();
  const text = `${code} is your Vipul Stone Suppliers login code. Do not share it.`;
  switch (env.OTP_PROVIDER) {
    case 'console':
      logger.warn({ mobile, code }, 'OTP (console provider, development only)');
      return;
    case 'msg91': {
      const r = await fetch('https://control.msg91.com/api/v5/otp', {
        method: 'POST',
        headers: { authkey: env.OTP_API_KEY ?? '', 'content-type': 'application/json' },
        body: JSON.stringify({ mobile: `91${mobile}`, otp: code }),
      });
      if (!r.ok) throw new Error(`msg91 ${r.status}`);
      return;
    }
    case 'twilio': {
      // OTP_API_KEY format: "ACCOUNT_SID:AUTH_TOKEN:FROM_NUMBER"
      const [sid, token, from] = (env.OTP_API_KEY ?? '').split(':');
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: `+91${mobile}`, From: from, Body: text }),
      });
      if (!r.ok) throw new Error(`twilio ${r.status}`);
      return;
    }
    default:
      throw new AppError(404, 'OTP_DISABLED', 'OTP login is not enabled');
  }
}

export async function requestOtp(usernameRaw: string, meta: LoginMeta = {}) {
  if (!otpEnabled()) throw new AppError(404, 'OTP_DISABLED', 'OTP login is not enabled');
  await connect();
  const username = mobileSchema.parse(usernameRaw);
  await enforce(`otp:ip:${meta.ip ?? 'unknown'}`, 10, 600);
  await enforce(`otp:user:${username}`, 3, 600);
  const user = await User.findOne({ username, active: true, otpEnabled: true }).lean();
  if (!user) return; // same response either way (no account enumeration)
  const code = String(randomInt(100000, 1000000));
  await Otp.deleteMany({ username });
  await Otp.create({ username, codeHash: sha(code), expireAt: new Date(Date.now() + 5 * 60_000) });
  await send(username, code);
}

export async function verifyOtp(usernameRaw: string, code: string, meta: LoginMeta = {}) {
  if (!otpEnabled()) throw new AppError(404, 'OTP_DISABLED', 'OTP login is not enabled');
  await connect();
  const username = mobileSchema.parse(usernameRaw);
  await enforce(`otpv:ip:${meta.ip ?? 'unknown'}`, 20, 600);
  const rec = await Otp.findOneAndUpdate({ username, expireAt: { $gt: new Date() } }, { $inc: { attempts: 1 } }, { returnDocument: 'after' });
  const bad = () => new AppError(401, 'INVALID_CODE', 'The code is wrong or has expired');
  if (!rec || rec.attempts > 5) throw bad();
  const a = Buffer.from(sha(String(code ?? '')));
  const b = Buffer.from(rec.codeHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw bad();
  await Otp.deleteMany({ username });
  const user = await User.findOne({ username, active: true, otpEnabled: true });
  if (!user) throw bad();
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null } });
  const { cookieValue, expiresAt } = await createSession(user._id, meta);
  return { user, cookieValue, expiresAt };
}
