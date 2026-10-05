// Structured logging. JSON in production for log shipping; pretty locally for humans.
import { pino, type Logger } from 'pino';
import type { AppConfig } from '../config/env.js';

export type { Logger };

/** Headers and fields that must never reach a log line. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.refreshToken',
  '*.pin',
];

export function createLogger(config: AppConfig, bindings: Record<string, string> = {}): Logger {
  const pretty = config.log.format === 'pretty' && config.log.level !== 'silent';
  return pino({
    level: config.log.level,
    base: { service: 'komtru-backend', env: config.nodeEnv, ...bindings },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
  });
}
