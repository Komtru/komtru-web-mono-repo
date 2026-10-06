// Shared setup for T-027's tests. The socket module is built from configuration and one injected
// `authenticate` port, so almost everything here is testable with no server and no connections.
import { randomBytes } from 'node:crypto';
import { loadConfig, type AppConfig } from '../../../src/config/env.js';
import { createLogger, type Logger } from '../../../src/platform/logger.js';
import { testRedisEnv, testRedisUrl } from '../../support/db-urls.js';

export const socketConfig = (overrides: Record<string, string> = {}): AppConfig =>
  loadConfig({
    LOG_LEVEL: 'silent',
    POSTGRES_URL: 'postgresql://x@localhost/x',
    REDIS_URL: testRedisUrl(),
    ...testRedisEnv(),
    IDENTITY_SIGNING_KEY: randomBytes(32).toString('hex'),
    IDENTITY_SIGNING_KEY_ID: 'test-key',
    ...overrides,
  });

export const silentLogger: Logger = createLogger(socketConfig());
