import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FeeScheduleError } from '@komtru/shared-types';
import { describe, expect, it } from 'vitest';
import {
  findFeesFile,
  getFeeSchedule,
  loadFeeSchedule,
  snapshotFees,
} from '../../../src/modules/config/index.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../../../..');
const FEES_FILE = resolve(REPO_ROOT, 'config/fees.yaml');
const text = readFileSync(FEES_FILE, 'utf8');

/** Returns the thrown error rather than asserting on a callback, so the message can be inspected. */
const thrownBy = (source: string): Error => {
  try {
    loadFeeSchedule(source, 'config/fees.yaml');
  } catch (error) {
    return error as Error;
  }
  throw new Error('loadFeeSchedule accepted a file it should have rejected');
};

describe('getFeeSchedule', () => {
  it('reads the committed file and exposes it', () => {
    const schedule = getFeeSchedule();
    expect(schedule.version).toBe('2026-10-05.1');
    expect(schedule.buyerProtectionFee.rateBps).toBe(150);
    expect(schedule.parkCashHandlingFee).toEqual({ minMinor: 30000n, maxMinor: 50000n });
  });

  it('returns the same object every time, so nothing re-reads the file per request', () => {
    expect(getFeeSchedule()).toBe(getFeeSchedule());
  });
});

describe('loadFeeSchedule', () => {
  it('refuses an invalid file, naming the bad key and not its value', () => {
    const error = thrownBy(text.replace('rate_bps: 150', 'rate_bps: 150.5'));
    expect(error).toBeInstanceOf(FeeScheduleError);
    expect(error.message).toContain('buyer_protection_fee.rate_bps');
    expect(error.message).not.toContain('150.5');
  });

  it('names a misspelled key rather than ignoring it', () => {
    expect(thrownBy(text.replace('payout_fee:', 'payout_fees:')).message).toContain('payout_fees');
  });

  it('refuses a file that is not YAML at all, naming the file', () => {
    const error = thrownBy('version: [unclosed\n');
    expect(error).toBeInstanceOf(FeeScheduleError);
    expect(error.message).toContain('config/fees.yaml');
  });
});

describe('snapshotFees', () => {
  it('snapshots at the live schedule', () => {
    expect(snapshotFees(5_000_000n, 'CASUAL').amounts.buyerTotalMinor).toBe('5075000');
  });
});

describe('findFeesFile', () => {
  it('finds config/fees.yaml from the source tree and from the compiled output', () => {
    for (const from of ['apps/backend-api/src/modules/config', 'apps/backend-api/dist/modules/config']) {
      expect(findFeesFile(resolve(REPO_ROOT, from))).toBe(FEES_FILE);
    }
  });

  it('names the file it looked for when there is no repository above it', () => {
    expect(() => findFeesFile('/')).toThrow(/config\/fees\.yaml/);
  });
});
