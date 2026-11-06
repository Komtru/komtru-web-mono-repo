// A domain module is a folder under src/modules/<name>/ whose index.ts exports one KomtruModule.
// The app mounts every module's routes under /v1 and runs its lifecycle hooks; modules talk to each
// other only through their index.ts (enforced by eslint-rules/module-boundaries.mjs).
import type { Request, Router } from 'express';
import type { Redis } from 'ioredis';
import type { AppConfig } from '../config/env.js';
import type { Db } from '../db/index.js';
import type { Logger } from './logger.js';
import { mountRoutes, type MountDeps } from './http/mount.js';
import type { Actor } from './http/principal.js';
import type { RouteDefinition } from './http/route.js';
import type { EventBus } from './events/bus.js';
import type { InProcessEmitter } from './events/emitter.js';
import type { HealthCheck } from './health.js';
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
  /** The process's configuration; a module reads its own section, never process.env. */
  config: AppConfig;
  /** The process logger. A module's jobs pass it to providerRequest, which logs one line per attempt. */
  logger: Logger;
  /**
   * The app's Redis client, under the `komtru:` key prefix. For a module's own caches; queues and
   * schedules have their own connections and never go through this one.
   */
  redis: Redis;
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
  /**
   * Reference data the schema needs in order to function — the RBAC catalogue, the reserved
   * username namespace — reconciled from code into the database.
   *
   * Not a migration, and deliberately so: this data changes whenever a module adds a permission or
   * Trust & Safety adds a brand, which is far more often than the schema changes. `pnpm db:migrate`
   * runs every module's seed once the migrations are applied, as the owner, and `pnpm db:seed`
   * re-runs them alone. Must be idempotent: it runs on every deploy.
   */
  seed?: (db: Db) => Promise<void>;
  /**
   * Who is calling. At most one module may answer this — identity does (T-031) — and `mountModules`
   * wires it into every route's scope and permission check. A registry with no such module leaves
   * every caller anonymous, which is what a process serving only PUBLIC routes wants.
   */
  resolveActor?: (req: Request) => Promise<Actor>;
  /** Told about each scope or permission 403, so identity can audit a refusal no handler saw. */
  onAccessDenied?: MountDeps['onDenied'];
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
  const resolvers = modules.filter((module) => module.resolveActor !== undefined);
  if (resolvers.length > 1) {
    // Two answers to "who is calling" is not a merge conflict to resolve at runtime.
    throw new Error(`more than one module resolves the actor: ${resolvers.map((m) => m.name).join(', ')}`);
  }
  const resolveActor = deps.resolveActor ?? resolvers[0]?.resolveActor;
  const onDenied = deps.onDenied ?? resolvers[0]?.onAccessDenied;
  return mountRoutes(
    modules.flatMap((module) => module.routes ?? []),
    {
      ...deps,
      ...(resolveActor ? { resolveActor } : {}),
      ...(onDenied ? { onDenied } : {}),
    },
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

/**
 * Runs every module's seed, in registry order, one after another rather than in parallel: a later
 * module's reference data may reference an earlier one's, and these run once per deploy.
 *
 * A failure names the module. Without that the stack is a drizzle insert and a constraint name, and
 * the operator has to guess which module's catalogue drifted.
 */
/**
 * A module reduced to its reference data. Seeding runs at migrate time, over the direct URL, with no
 * Redis and no signing key — so it must not require a module built from a running process's
 * connections.
 */
export type SeedableModule = Pick<KomtruModule, 'name' | 'seed'>;

export async function runModuleSeeds(modules: SeedableModule[], db: Db): Promise<void> {
  for (const module of modules) {
    if (!module.seed) continue;
    try {
      await module.seed(db);
    } catch (error) {
      throw new Error(`module "${module.name}" failed to seed`, { cause: error });
    }
  }
}
