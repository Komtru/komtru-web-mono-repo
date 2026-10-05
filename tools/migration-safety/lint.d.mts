import type { Finding } from './migrations.d.mts';

export declare const RULES: Record<string, { summary: string }>;
export declare function splitStatements(sql: string): string[];
export declare function createdTables(sql: string): Set<string>;
export declare function lintMigration(input: {
  tag: string;
  sql: string;
  /** `schema.table` for every table that existed before this migration ran. */
  existingTables: Set<string>;
}): Finding[];
export declare function checkLint(dir?: string): Finding[];
