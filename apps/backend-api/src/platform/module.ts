// A domain module is a folder under src/modules/<name>/ whose index.ts exports one KomtruModule.
// The app mounts every module's routes under /v1 and runs its lifecycle hooks; modules talk to each
// other only through their index.ts (enforced by eslint-rules/module-boundaries.mjs).
import type { Router } from 'express';
import type { AppConfig } from '../config/env.js';
import type { Db } from '../db/index.js';
import { mountRoutes, type MountDeps } from './http/mount.js';
import type { RouteDefinition } from './http/route.js';
import type { EventBus } from './events/bus.js';
import type { InProcessEmitter } from './events/emitter.js';
import type { HealthCheck } from './health.js';
import type { Logger } from './logger.js';
import type { QueueDefinition, QueueFactory } from './queue/factory.js';
import type { ScheduledJob } from './scheduler/registry.js';
import type { Closer } from './shutdown.js';

/** What a module gets at start. */
export interface ModuleContext {
  /** Producers work in every process; consumers run only in the worker. */
  queues: QueueFactory;
  /** Publish inside a caller's transaction; subscribe in start() (handlers run in the worker). */
  events: EventBus;
  /** In-process only, lossy by design: cache invalidation and socket fan-out, nothing durable. */
  emitter: InProcessEmitter;
  /** The runtime pool, as komtru_app through PgBouncer. */
  db: Db;
  /**
   * The configuration this process was started with. A module has no other way to see a tuning
   * variable, and reading `process.env` inside one would diverge from the environment the process
   * was actually given (which the integration tests craft by hand).
   */
  config: AppConfig;
  /** The process logger, already bound to `process: 'api' | 'worker'`. */
  logger: Logger;
}

export interface KomtruModule {
  name: string;
  /**
   * This module's routes, each built with `defineRoute`. There is no other way to register one:
   * the registry's invariants (pagination, an explicit retryable decision) are checked at boot.
   */
  routes?: RouteDefinition[];
  /** Extra readiness checks the module needs (beyond Postgres and Redis). */
  healthChecks?: HealthCheck[];
  /** Queues this module consumes; the worker runs them, every process can produce to them. */
  queues?: QueueDefinition<never>[];
  /** Recurring jobs (`module.job-name`, cron in Africa/Lagos); only the worker schedules them. */
  schedules?: ScheduledJob[];
  /** Runs at process start, in registry order (e.g. subscribing to events). */
  start?: (ctx: ModuleContext) => Promise<void>;
  /** Runs at shutdown, in reverse registry order. */
  stop?: () => Promise<void>;
}

export const defineModule = (module: KomtruModule): KomtruModule => module;

const assertUniqueNames = (modules: KomtruModule[]): void => {
  const seen = new Set<string>();
  for (const { name } of modules) {
    if (seen.has(name)) throw new Error(`duplicate module "${name}" in the registry`);
    seen.add(name);
  }
};

/** Returns the function createApp uses to mount every module's routes on /v1. */
export function mountModules(modules: KomtruModule[], deps: MountDeps): (router: Router) => void {
  assertUniqueNames(modules);
  return mountRoutes(
    modules.flatMap((module) => module.routes ?? []),
    deps,
  );
}

export const moduleHealthChecks = (modules: KomtruModule[]): HealthCheck[] =>
  modules.flatMap((m) => m.healthChecks ?? []);

/** One closer per module, in reverse start order, so a failing stop never skips the others. */
export const moduleClosers = (modules: KomtruModule[]): Closer[] =>
  [...modules].reverse().flatMap((module) => {
    const { stop } = module;
    return stop ? [{ name: `module:${module.name}`, close: () => stop() }] : [];
  });
