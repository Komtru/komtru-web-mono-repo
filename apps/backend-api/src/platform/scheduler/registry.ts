// Cannibalized from kumtru/backend-apis/src/modules/scheduler/domain/registry.ts (T-001), adapted:
// one registry per process instead of a module-level Map, so tests and processes never share state.
//
// The declarative half of the scheduler: a name, a cron pattern, a function. Pure: no Redis. Both
// processes build the same registry from the module list; only the worker starts it.
import { CronExpressionParser } from 'cron-parser';

export interface ScheduledJob {
  /**
   * Stable identity, `module.job-name`. Doubles as the BullMQ job-scheduler id, which is what makes
   * N worker instances converge on ONE schedule rather than N. Renaming a job orphans its old
   * schedule in Redis; startScheduler prunes it.
   */
  name: string;
  /** 5- or 6-field cron, evaluated in the scheduler's timezone (Africa/Lagos), not UTC. */
  cron: string;
  /** One line on what the job is for; logged at startup. */
  description: string;
  /**
   * The work. Receives the occurrence's SCHEDULED time, so a late run computes cutoffs from when it
   * was supposed to run. Return counts rather than void: a job that ran and did nothing and a job
   * that never ran are otherwise indistinguishable in the logs.
   */
  handler: (firedAt: Date) => Promise<unknown>;
}

export interface ScheduleRegistry {
  register(job: ScheduledJob): void;
  get(name: string): ScheduledJob | undefined;
  /** In registration order. */
  list(): ScheduledJob[];
}

/**
 * Lowercase alphanumerics, hyphens inside a segment but never at an edge or doubled. Character checks
 * instead of a regex: the natural regex nests quantifiers, which is a ReDoS shape.
 */
const isValidSegment = (segment: string): boolean => {
  if (segment.length === 0) return false;
  if (segment.startsWith('-') || segment.endsWith('-') || segment.includes('--')) return false;
  return [...segment].every((ch) => (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === '-');
};

const isValidJobName = (name: string): boolean => {
  const segments = name.split('.');
  // At least the owning module and the job itself.
  return segments.length >= 2 && segments.every(isValidSegment);
};

export function createScheduleRegistry(): ScheduleRegistry {
  const jobs = new Map<string, ScheduledJob>();
  return {
    /**
     * Throws on a bad name, a bad cron or a duplicate. Registration happens at boot, so the process
     * refuses to start: a typo'd cron that silently never fires is exactly the bug to rule out.
     */
    register(job) {
      if (!isValidJobName(job.name)) {
        throw new Error(`scheduler: '${job.name}' is not a valid job name (expected module.job-name)`);
      }
      if (jobs.has(job.name)) throw new Error(`scheduler: '${job.name}' is already registered`);
      // cron-parser is BullMQ's own parser, so this validates the expression BullMQ will evaluate.
      try {
        CronExpressionParser.parse(job.cron);
      } catch (error) {
        throw new Error(`scheduler: '${job.name}' has an invalid cron '${job.cron}': ${String(error)}`);
      }
      jobs.set(job.name, job);
    },
    get: (name) => jobs.get(name),
    list: () => [...jobs.values()],
  };
}
