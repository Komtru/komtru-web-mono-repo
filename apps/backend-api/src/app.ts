// Builds the Express app from injected dependencies, so tests run it without any network.
import compression from 'compression';
import cors from 'cors';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { AppConfig } from './config/env.js';
import { errorHandler, notFound } from './platform/errors.js';
import type { Logger } from './platform/logger.js';
import { requestId } from './platform/request-id.js';

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  /** Mounts versioned routes; the module registry provides this in production. */
  mountV1?: (router: Router) => void;
  /** Mounts unversioned operational routes such as /health. */
  mountRoot?: (app: Express) => void;
  /** Called for every unexpected error, e.g. to report it to Sentry. */
  onUnexpected?: (error: unknown) => void;
}

export function createApp({
  config,
  logger,
  mountV1,
  mountRoot,
  onUnexpected = () => {},
}: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.http.trustProxyHops);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) =>
        callback(null, origin !== undefined && config.http.allowedOrigins.includes(origin)),
      credentials: true,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '100kb' }));

  mountRoot?.(app);

  const v1 = Router();
  mountV1?.(v1);
  app.use('/v1', v1);

  app.use(notFound);
  app.use(errorHandler(logger, onUnexpected));
  return app;
}
