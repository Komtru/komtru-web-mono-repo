export interface Finding {
  /** Which check produced it: `journal`, `lock`, `lint`, `replay`, `invariants` or `forward`. */
  check: string;
  rule: string;
  tag?: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface Snapshot {
  id: string;
  prevId: string;
  version: string;
  dialect: string;
  tables: Record<string, unknown>;
}

export interface Migration {
  idx: number;
  tag: string;
  /** The journal's generation timestamp; the migrator applies strictly in increasing order of it. */
  when: number;
  sql: string;
  /** sha256 of the whole file, the hash drizzle writes to drizzle.__drizzle_migrations. */
  sha256: string;
  snapshot: Snapshot;
}

export declare const MIGRATIONS_DIR: string;
export declare const LOCK_PATH: string;
export declare function finding(
  check: string,
  rule: string,
  message: string,
  extra?: Partial<Finding>,
): Finding;
export declare function loadMigrations(dir?: string): Migration[];
export declare function checkJournal(dir?: string): Finding[];
export declare function checkLock(dir?: string, lockPath?: string): Finding[];
export declare function writeLock(dir?: string, lockPath?: string): void;
