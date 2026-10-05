import type { Finding } from './migrations.d.mts';

export declare const RULES: Record<string, { summary: string }>;
export declare const WAIVERS_PATH: string;
/** `tag` -> `rule` -> the reason that rule is acceptable in that migration. */
export declare function readWaiverFile(path?: string): Record<string, Record<string, string>>;
export declare function splitStatements(sql: string): string[];
export declare function createdTables(sql: string): Set<string>;
export declare function lintMigration(input: {
  tag: string;
  sql: string;
  /** `schema.table` for every table that existed before this migration ran. */
  existingTables: Set<string>;
  /** `rule` -> reason, from waivers.json. */
  waivers?: Record<string, string>;
}): Finding[];
export declare function checkLint(dir?: string, waiverPath?: string): Finding[];
