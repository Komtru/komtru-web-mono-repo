// A domain module is a folder under src/modules/<name>/ whose index.ts exports one KomtruModule.
// The app mounts every module's routes under /v1 and runs its lifecycle hooks; modules talk to each
// other only through their index.ts (enforced by eslint-rules/module-boundaries.mjs).
import type { Router } from 'express';
import type { HealthCheck } from './health.js';
import type { QueueDefinition, QueueFactory } from './queue/factory.js';
import type { ScheduledJob } from './scheduler/registry.js';
import type { Closer } from './shutdown.js';

/** What a module gets at start. */
export interface ModuleContext {
  /** Producers work in every process; consumers run only in the worker. */
  queues: QueueFactory;
}

export interface KomtruModule {
  name: string;
  /** Registers this module's routes on the /v1 router. */
  routes?: (router: Router) => void;
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
export function mountModules(modules: KomtruModule[]): (router: Router) => void {
  assertUniqueNames(modules);
  return (router) => {
    for (const module of modules) module.routes?.(router);
  };
}

export const moduleHealthChecks = (modules: KomtruModule[]): HealthCheck[] =>
  modules.flatMap((m) => m.healthChecks ?? []);

/** One closer per module, in reverse start order, so a failing stop never skips the others. */
export const moduleClosers = (modules: KomtruModule[]): Closer[] =>
  [...modules].reverse().flatMap((module) => {
    const { stop } = module;
    return stop ? [{ name: `module:${module.name}`, close: () => stop() }] : [];
  });
