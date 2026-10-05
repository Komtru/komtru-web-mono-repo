import type pg from 'pg';
import type { Finding, Migration } from './migrations.d.mts';

export interface InvariantEntry {
  /** `schema.table` the rule is attached to. */
  table: string;
  name: string;
  /** `pg_get_indexdef` / `pg_get_constraintdef` / `pg_get_triggerdef`, verbatim. */
  definition: string;
}

export interface Invariants {
  postgresMajor: number;
  partialUniqueIndexes: InvariantEntry[];
  checkConstraints: InvariantEntry[];
  triggers: InvariantEntry[];
}

export declare const INVARIANTS_PATH: string;
export declare function directUrl(database: string): string;
export declare function scratchDatabase<T>(label: string, run: (client: pg.Client) => Promise<T>): Promise<T>;
export declare function applyMigrations(
  client: pg.Client,
  migrations: Migration[],
): Promise<{ applied: Migration[]; skipped: Migration[] }>;
export declare function fingerprint(client: pg.Client): Promise<string[]>;
export declare function introspectInvariants(client: pg.Client): Promise<Invariants>;
export declare function checkInvariants(actual: Invariants, expected: Invariants): Finding[];
export declare function readInvariants(path?: string): Invariants;
export declare function writeInvariants(invariants: Invariants, path?: string): void;
