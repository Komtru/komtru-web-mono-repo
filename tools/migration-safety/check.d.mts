import type { Finding, Migration } from './migrations.d.mts';

export type Baseline =
  | { ref: string; commit: string; migrations: Migration[]; explicit: boolean }
  | { ref: null; reason: string; explicit: boolean };

export declare function baseMigrations(ref?: string): Baseline;
export declare function compareForward(base: Migration[], head: Migration[]): Promise<Finding[]>;
export declare function checkForward(ref?: string): Promise<Finding[]>;
export declare function runChecks(options?: {
  staticOnly?: boolean;
  ref?: string;
  /** The migration folder to check; defaults to the backend's. */
  dir?: string;
}): Promise<{
  findings: Finding[];
  counts: Record<string, number>;
  /** The checks that actually ran, in order, for the summary line. */
  ran: string[];
}>;
