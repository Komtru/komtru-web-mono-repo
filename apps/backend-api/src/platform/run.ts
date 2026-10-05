// Shared entrypoint behaviour for both processes: start, stop on SIGTERM/SIGINT, and exit non-zero
// on a startup failure or a crash. Configuration errors print variable names only.
import { ConfigError } from '../config/env.js';
import type { ShutdownResult } from './shutdown.js';

export async function runProcess(start: () => Promise<{ stop(): Promise<ShutdownResult> }>): Promise<void> {
  let running: { stop(): Promise<ShutdownResult> };
  try {
    running = await start();
  } catch (error) {
    const message = error instanceof ConfigError ? error.message : 'Startup failed.';
    process.stderr.write(`${message}\n`);
    if (!(error instanceof ConfigError) && error instanceof Error) process.stderr.write(`${error.stack}\n`);
    process.exit(1);
  }

  let stopping = false;
  const stop = async (exitCode: number) => {
    if (stopping) return;
    stopping = true;
    const result = await running.stop();
    process.exit(result.clean ? exitCode : 1);
  };

  process.once('SIGTERM', () => void stop(0));
  process.once('SIGINT', () => void stop(0));
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`Unhandled rejection: ${String(reason)}\n`);
    void stop(1);
  });
}
