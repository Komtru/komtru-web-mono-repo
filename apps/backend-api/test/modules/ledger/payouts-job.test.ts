// The process-payout job's handling of a pending transfer (T-073): a poll, not a failed attempt.
import { DelayedError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import {
  PAYOUT_POLL_MAX_MS,
  payoutPollDelayMs,
  processPayoutJob,
} from '../../../src/modules/ledger/jobs/payouts.job.js';
import * as dispatch from '../../../src/modules/ledger/services/payoutDispatch.service.js';

const deps = {} as dispatch.PayoutDispatchDeps;
const job = () => ({
  updateData: vi.fn(() => Promise.resolve()),
  moveToDelayed: vi.fn(() => Promise.resolve()),
});

describe('the process-payout job', () => {
  it('moves a pending payout back to delayed and throws DelayedError, spending no attempt', async () => {
    vi.spyOn(dispatch, 'processPayout').mockRejectedValueOnce(
      new dispatch.PayoutStillPendingError('p', 'pending'),
    );
    const j = job();
    const before = Date.now();
    await expect(processPayoutJob(deps, { payoutId: 'p', polls: 2 }, j, 'token')).rejects.toBeInstanceOf(
      DelayedError,
    );
    expect(j.updateData).toHaveBeenCalledWith({ payoutId: 'p', polls: 3 });
    const [at, token] = j.moveToDelayed.mock.calls[0] as unknown as [number, string];
    expect(token).toBe('token');
    expect(at).toBeGreaterThanOrEqual(before + payoutPollDelayMs(2));
  });

  it('lets a real failure use the attempts', async () => {
    const outage = new Error('provider down');
    vi.spyOn(dispatch, 'processPayout').mockRejectedValueOnce(outage);
    const j = job();
    await expect(processPayoutJob(deps, { payoutId: 'p' }, j, 'token')).rejects.toBe(outage);
    expect(j.moveToDelayed).not.toHaveBeenCalled();
  });

  it('polls at 5 s doubling, never slower than every fifteen minutes', () => {
    expect([0, 1, 2].map(payoutPollDelayMs)).toEqual([5_000, 10_000, 20_000]);
    expect(payoutPollDelayMs(50)).toBe(PAYOUT_POLL_MAX_MS);
  });
});
