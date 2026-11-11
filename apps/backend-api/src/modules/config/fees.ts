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
  snapshotParkCashFee as snapshotParkCash,
  snapshotPayoutFee as snapshotPayout,
  type FeeSchedule,
  type FeeSnapshot,
  type Kobo,
  type ParkCashFeeSnapshot,
  type PayoutFeeSnapshot,
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
    // Stop at the workspace root rather than walking to `/`. Without this, a deployment whose app
    // directory lacks the file would silently load a stray ancestor copy — and in this repo's own
    // worktree layout it would walk past `.claude/worktrees/<x>/` into the main checkout.
    if (existsSync(resolve(directory, 'pnpm-workspace.yaml'))) {
      throw new FeeScheduleError(`${FEES_FILE} was not found between ${from} and the workspace root`);
    }
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
  } catch (error) {
    // The parser's line and column, never its snippet: where the mistake is does not leak a value,
    // and an operator with a tab-indentation slip has nothing else to go on.
    const at = (error as { linePos?: [{ line: number; col: number }] }).linePos?.[0];
    throw new FeeScheduleError(
      at ? `${source} is not valid YAML (line ${at.line}, column ${at.col})` : `${source} is not valid YAML`,
    );
  }
  return parseFeeSchedule(document, source);
}

// Read once, at import. src/modules/index.ts is imported by server.ts and worker-process.ts, so an
// invalid file throws before either process listens — the same "fail at boot, naming the key"
// contract src/config/env.ts gives environment variables.
const feesPath = findFeesFile(import.meta.dirname);
const schedule = loadFeeSchedule(readFileSync(feesPath, 'utf8'), FEES_FILE);
// "Which file did it actually load, and which version is live" is the first question an incident
// asks about a money config found by walking up directories. This runs during module evaluation,
// before any process has built its logger, so a bare console call is the only thing available —
// and silence would be worse than one line on stdout.
// eslint-disable-next-line no-console -- see above: no logger exists at import time
console.info(`fees: loaded ${schedule.version} from ${feesPath}`);

export const getFeeSchedule = (): FeeSchedule => schedule;

/** Where the live schedule was read from, for the boot log and for diagnosing a stale deployment. */
export const feeScheduleSource = (): string => feesPath;

/** The Park handling fee as a parcel freezes it. The guard forbids park code reaching past here. */
export const snapshotParkCashFee = (takenAt?: Date): ParkCashFeeSnapshot =>
  snapshotParkCash(schedule, takenAt);

/** The live schedule's snapshot, for a trade whose terms are being accepted now. */
export const snapshotFees = (itemMinor: Kobo, sellerKind: SellerKind, takenAt?: Date): FeeSnapshot =>
  snapshotTradeFees(itemMinor, sellerKind, schedule, takenAt);

/**
 * The `payout_fee` as one payout freezes it (T-073). The ledger may not read the live schedule (the
 * fee guard keeps it on snapshots), so this is the one sanctioned read of the payout fee, exactly as
 * `snapshotParkCashFee` is the Park module's.
 */
export const snapshotPayoutFee = (takenAt?: Date): PayoutFeeSnapshot => snapshotPayout(schedule, takenAt);
