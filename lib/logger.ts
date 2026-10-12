import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  redact: { paths: ['req.headers.cookie', 'req.headers.authorization', '*.password', '*.passwordHash', '*.token'], censor: '[redacted]' },
  base: { app: 'vss-erp' },
});
