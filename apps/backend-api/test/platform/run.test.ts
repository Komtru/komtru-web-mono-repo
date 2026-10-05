import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { ConfigError } from '../../src/config/env.js';
import { runProcess, type ProcessHost, type RunningProcess } from '../../src/platform/run.js';

const fakeHost = () =>
  Object.assign(new EventEmitter(), {
    exit: vi.fn(),
    stderr: { write: vi.fn() },
  }) satisfies ProcessHost;

const fakeRunning = (clean = true) =>
  ({
    stop: vi.fn(() => Promise.resolve({ clean, failed: [], timedOut: false })),
    reportFatal: vi.fn(),
  }) satisfies RunningProcess;

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('runProcess', () => {
  it.each(['uncaughtException', 'unhandledRejection'])(
    'reports a %s as fatal, shuts down and exits 1',
    async (event) => {
      const host = fakeHost();
      const running = fakeRunning();
      await runProcess(() => Promise.resolve(running), host);
      const error = new Error('kaboom');
      host.emit(event, error);
      await settle();
      expect(running.reportFatal).toHaveBeenCalledWith(error, event);
      expect(running.stop).toHaveBeenCalledOnce();
      expect(host.exit).toHaveBeenCalledWith(1);
    },
  );

  it('exits 0 after a clean SIGTERM shutdown, and stops only once', async () => {
    const host = fakeHost();
    const running = fakeRunning();
    await runProcess(() => Promise.resolve(running), host);
    host.emit('SIGTERM');
    host.emit('uncaughtException', new Error('during shutdown'));
    await settle();
    expect(running.stop).toHaveBeenCalledOnce();
    expect(host.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('exits 1 when shutdown is not clean', async () => {
    const host = fakeHost();
    await runProcess(() => Promise.resolve(fakeRunning(false)), host);
    host.emit('SIGINT');
    await settle();
    expect(host.exit).toHaveBeenCalledWith(1);
  });

  it('names missing configuration and exits 1 when startup fails', async () => {
    const host = fakeHost();
    await runProcess(() => Promise.reject(new ConfigError(['POSTGRES_URL'], [])), host);
    expect(host.stderr.write).toHaveBeenCalledWith(expect.stringMatching(/POSTGRES_URL/));
    expect(host.exit).toHaveBeenCalledWith(1);
  });
});
