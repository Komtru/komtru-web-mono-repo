// The backend's view of config/fees.yaml (design §6.5). Every fee the backend charges, posts or
// displays comes from here: no other module reads the file, and the module-boundaries rule plus the
// repo-level fee guard are what keep it that way.
//
// To change a fee safely: edit config/fees.yaml, bump its `version`, open a PR. Nothing in this
// file needs to change. Runbook: docs/runbooks/fees.md.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  FeeScheduleError,
  parseFeeSchedule,
  snapshotFees as snapshotTradeFees,
  type FeeSchedule,
  type FeeSnapshot,
  type Kobo,
  type SellerKind,
} from '@komtru/shared-types';
import { parse } from 'yaml';

const FEES_FILE = 'config/fees.yaml';

/**
 * Walks up from a starting directory to the repository root. One file then serves `src/` under tsx,
 * `dist/` under node and a test run, without a build step that copies it or an environment variable
 * that could quietly point a deployed process at a different schedule.
 */
export function findFeesFile(from: string): string {
  let directory = resolve(from);
  for (;;) {
    const candidate = resolve(directory, FEES_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) throw new FeeScheduleError(`${FEES_FILE} was not found above ${from}`);
    directory = parent;
  }
}

/** Parses and validates the file's text. Errors name the key or the file, never a configured value. */
export function loadFeeSchedule(text: string, source: string): FeeSchedule {
  let document: unknown;
  try {
    document = parse(text);
  } catch {
    throw new FeeScheduleError(`${source} is not valid YAML`);
  }
  return parseFeeSchedule(document, source);
}

// Read once, at import. src/modules/index.ts is imported by server.ts and worker-process.ts, so an
// invalid file throws before either process listens — the same "fail at boot, naming the key"
// contract src/config/env.ts gives environment variables.
const schedule = loadFeeSchedule(readFileSync(findFeesFile(import.meta.dirname), 'utf8'), FEES_FILE);

export const getFeeSchedule = (): FeeSchedule => schedule;

/** The live schedule's snapshot, for a trade whose terms are being accepted now. */
export const snapshotFees = (itemMinor: Kobo, sellerKind: SellerKind, takenAt?: Date): FeeSnapshot =>
  snapshotTradeFees(itemMinor, sellerKind, schedule, takenAt);
