// Every error leaves the API as RFC 9457 problem details. Expected failures are ApiErrors; anything
// else is a bug, reported to Sentry and answered with a generic 500 that leaks nothing.
import { problemTypeUri, type ProblemCode, type ProblemDetails } from '@komtru/shared-types';
import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import type { Logger } from './logger.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ProblemCode,
    readonly title: string,
    readonly detail?: string,
    readonly fieldErrors?: { path: string; message: string }[],
  ) {
    super(title);
    this.name = 'ApiError';
  }
}

export function sendProblem(res: Response, problem: ProblemDetails): void {
  res.status(problem.status).type('application/problem+json').json(problem);
}

const toProblem = (error: ApiError): ProblemDetails => ({
  type: problemTypeUri(error.code),
  title: error.title,
  status: error.status,
  code: error.code,
  ...(error.detail ? { detail: error.detail } : {}),
  ...(error.fieldErrors ? { errors: error.fieldErrors } : {}),
});

/** body-parser marks its own errors with `type` and a 4xx `status`. */
const bodyParserError = (error: unknown): ApiError | undefined => {
  if (typeof error !== 'object' || error === null || !('type' in error)) return undefined;
  const { type } = error;
  if (type === 'entity.parse.failed') {
    return new ApiError(400, 'VALIDATION_FAILED', 'The request body is not valid JSON');
  }
  if (type === 'entity.too.large') {
    return new ApiError(413, 'VALIDATION_FAILED', 'The request body is too large');
  }
  return undefined;
};

/**
 * Express, its router and body-parser signal the client's mistakes (unsupported charset, malformed
 * path encoding, ...) with a 4xx `status`. Those are not bugs: answer with that status and a generic
 * title, and keep them out of Sentry. Their messages stay out of the response.
 */
const clientError = (error: unknown): ApiError | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = 'status' in error ? error.status : 'statusCode' in error ? error.statusCode : undefined;
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 400 || status > 499)
    return undefined;
  return new ApiError(status, 'VALIDATION_FAILED', 'The request could not be processed');
};

export const notFound: RequestHandler = () => {
  throw new ApiError(404, 'NOT_FOUND', 'Not found');
};

export function errorHandler(logger: Logger, onUnexpected: (error: unknown) => void): ErrorRequestHandler {
  return (error: unknown, req, res, _next) => {
    if (error instanceof ApiError) {
      sendProblem(res, toProblem(error));
      return;
    }
    if (error instanceof ZodError) {
      const fieldErrors = error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      sendProblem(
        res,
        toProblem(new ApiError(422, 'VALIDATION_FAILED', 'Invalid request', undefined, fieldErrors)),
      );
      return;
    }
    const client = bodyParserError(error) ?? clientError(error);
    if (client) {
      sendProblem(res, toProblem(client));
      return;
    }

    logger.error({ err: error, requestId: req.requestId }, 'unhandled error');
    onUnexpected(error);
    sendProblem(res, {
      type: problemTypeUri('INTERNAL'),
      title: 'Something went wrong',
      status: 500,
      code: 'INTERNAL',
      instance: req.requestId,
    });
  };
}
