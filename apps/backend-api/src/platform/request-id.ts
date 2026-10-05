// Every request carries an id: in the X-Request-Id response header, in every log line, and in a 500's
// `instance`, so a user's screenshot of an error can be matched to the server log.
import type { NextFunction, Request, Response } from 'express';
import { v7 as uuidv7 } from 'uuid';

const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;

declare module 'express-serve-static-core' {
  interface Request {
    /** The request's correlation id (client-supplied if safe, otherwise generated). */
    requestId: string;
  }
}

/** Accepts a caller's id only if it is short and plain; anything else could pollute logs. */
export const resolveRequestId = (incoming: string | undefined): string =>
  incoming && SAFE_ID.test(incoming) ? incoming : uuidv7();

export function requestId(req: Request, res: Response, next: NextFunction): void {
  req.requestId = resolveRequestId(req.get('x-request-id'));
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
