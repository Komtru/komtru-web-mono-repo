// Shared entrypoint behaviour for both processes: start, stop on SIGTERM/SIGINT, and exit non-zero
// on a startup failure or a crash. Configuration errors print variable names only.
import { ConfigError } from '../config/env.js';
import type { ShutdownResult } from './shutdown.js';

export interface RunningProcess {
  stop(): Promise<ShutdownResult>;
  /** Logs a crash at fatal level and reports it to Sentry; `stop` then flushes Sentry. */
  reportFatal(error: unknown, origin: string): void;
}

/** The slice of `process` this uses, so tests can drive it with a fake. */
export interface ProcessHost {
  once: (event: string, listener: (...args: unknown[]) => void) => unknown;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
  exit: (code: number) => void;
  stderr: { write: (text: string) => unknown };
}

export async function runProcess(
  start: () => Promise<RunningProcess>,
  host: ProcessHost = process,
): Promise<void> {
  let running: RunningProcess;
  try {
    running = await start();
  } catch (error) {
    const message = error instanceof ConfigError ? error.message : 'Startup failed.';
    host.stderr.write(`${message}\n`);
    if (!(error instanceof ConfigError) && error instanceof Error) host.stderr.write(`${error.stack}\n`);
    host.exit(1);
    return;
  }

  let stopping = false;
  const stop = async (exitCode: number) => {
    if (stopping) return;
    stopping = true;
    const result = await running.stop();
    host.exit(result.clean ? exitCode : 1);
  };
  // The process state is unknown after a crash: report it, release what we can, and exit 1.
  const crash = (origin: string) => (error: unknown) => {
    if (stopping) return;
    running.reportFatal(error, origin);
    void stop(1);
  };

  host.once('SIGTERM', () => void stop(0));
  host.once('SIGINT', () => void stop(0));
  host.on('uncaughtException', crash('uncaughtException'));
  host.on('unhandledRejection', crash('unhandledRejection'));
}
