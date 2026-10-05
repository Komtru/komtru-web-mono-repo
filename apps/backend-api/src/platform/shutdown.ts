// Graceful shutdown: stop taking work, finish what is in flight, release connections — in that order,
// within a deadline. A closer that throws is logged and skipped; the rest still run.
import type { Logger } from './logger.js';

export interface Closer {
  name: string;
  close(): Promise<void>;
}

export interface ShutdownResult {
  clean: boolean;
  failed: string[];
  timedOut: boolean;
}

export async function gracefulShutdown({
  closers,
  timeoutMs,
  logger,
}: {
  closers: Closer[];
  timeoutMs: number;
  logger: Logger;
}): Promise<ShutdownResult> {
  const failed: string[] = [];

  const runAll = async (): Promise<'done'> => {
    for (const closer of closers) {
      try {
        await closer.close();
        logger.info({ closer: closer.name }, 'closed');
      } catch (error) {
        failed.push(closer.name);
        logger.error({ err: error, closer: closer.name }, 'closer failed during shutdown');
      }
    }
    return 'done';
  };

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });

  const outcome = await Promise.race([runAll(), deadline]);
  clearTimeout(timer);
  const timedOut = outcome === 'timeout';
  if (timedOut) logger.error({ timeoutMs }, 'shutdown deadline reached; exiting with work unfinished');
  return { clean: !timedOut && failed.length === 0, failed, timedOut };
}
