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
  /** True once shutdown has begun; responses then close their connection (see server.ts). */
  isDraining?: () => boolean;
}

export function createApp({
  config,
  logger,
  mountV1,
  mountRoot,
  onUnexpected = () => {},
  isDraining = () => false,
}: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.http.trustProxyHops);

  // Decided when headers are written, not when the request arrives: a request already in flight
  // when shutdown starts must still close its keep-alive connection.
  app.use((_req, res, next) => {
    const writeHead = res.writeHead.bind(res);
    res.writeHead = ((...args: Parameters<typeof writeHead>) => {
      if (isDraining()) res.setHeader('Connection', 'close');
      return writeHead(...args);
    }) as typeof writeHead;
    next();
  });
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
