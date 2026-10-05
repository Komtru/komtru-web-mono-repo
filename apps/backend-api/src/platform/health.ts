// Liveness says the process is up (no I/O, so a slow database never gets a healthy process killed).
// Readiness says it can serve traffic: every dependency answers within a timeout.
import type { Express } from 'express';

export interface HealthCheck {
  name: string;
  check(): Promise<void>;
}

export type CheckResult = 'ok' | 'failed' | 'timeout';

const withTimeout = (promise: Promise<void>, ms: number): Promise<CheckResult> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve('ok');
      },
      () => {
        clearTimeout(timer);
        resolve('failed');
      },
    );
  });

export async function runChecks(
  checks: HealthCheck[],
  timeoutMs = 2000,
): Promise<{ ok: boolean; checks: Record<string, CheckResult> }> {
  const results = await Promise.all(
    checks.map(async (c) => [c.name, await withTimeout(c.check(), timeoutMs)] as const),
  );
  return {
    ok: results.every(([, r]) => r === 'ok'),
    checks: Object.fromEntries(results),
  };
}

/** Mounts /health/live and /health/ready (outside /v1: these are for load balancers, not clients). */
export const healthRoutes =
  (checks: HealthCheck[], timeoutMs = 2000) =>
  (app: Express): void => {
    app.get('/health/live', (_req, res) => {
      res.set('Cache-Control', 'no-store').json({ status: 'ok' });
    });
    app.get('/health/ready', async (_req, res) => {
      const result = await runChecks(checks, timeoutMs);
      res
        .status(result.ok ? 200 : 503)
        .set('Cache-Control', 'no-store')
        .json({ status: result.ok ? 'ok' : 'unavailable', checks: result.checks });
    });
  };
