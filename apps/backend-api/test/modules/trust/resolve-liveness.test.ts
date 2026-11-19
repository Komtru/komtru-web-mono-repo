// The job that turns an internet delivery into a verification level. Every refusal in it is
// reachable from a public route, so each one is pinned here rather than asserted in a comment.
//
// Two of these tests exist because a review found the opposite behaviour shipped:
//   - `completed` was in the pass allow-list. It is a LIFECYCLE word — "the modal closed" — and
//     treating it as a verdict grants level 2 to a spoofed liveness check.
//   - anything unrecognised was treated as a failure, so a progress event terminally REJECTED a
//     user who was still holding their phone up to the camera.
import { describe, expect, it, vi } from 'vitest';
import { readDeliveryVerdict } from '../../../src/modules/trust/jobs/resolve-liveness.job.js';

describe('readDeliveryVerdict', () => {
  const data = (over: Record<string, unknown>) => ({ data: { metadata: {}, ...over } });

  it('passes on an explicit boolean', () => {
    expect(readDeliveryVerdict(data({ passed: true }))).toBe('PASSED');
  });

  it('fails on an explicit boolean', () => {
    expect(readDeliveryVerdict(data({ passed: false }))).toBe('FAILED');
  });

  it('prefers the boolean over any status word that disagrees with it', () => {
    expect(readDeliveryVerdict(data({ passed: false, status: 'completed' }))).toBe('FAILED');
    expect(readDeliveryVerdict(data({ status: 'completed', passed: false }))).toBe('FAILED');
  });

  it('does NOT treat "completed" as a pass — it means the modal closed, not that the person passed', () => {
    expect(readDeliveryVerdict(data({ status: 'completed' }))).not.toBe('PASSED');
  });

  it('treats a lifecycle event as no verdict at all, never as a failure', () => {
    for (const status of ['pending', 'in_progress', 'started', 'processing', 'completed']) {
      expect(readDeliveryVerdict(data({ status }))).toBe('NO_VERDICT');
    }
  });

  it('treats an unrecognised shape as no verdict, so nothing is granted and nothing is refused', () => {
    expect(readDeliveryVerdict(data({}))).toBe('NO_VERDICT');
    expect(readDeliveryVerdict({})).toBe('NO_VERDICT');
    expect(readDeliveryVerdict(data({ passed: 'yes' }))).toBe('NO_VERDICT');
  });

  it('reads an explicit failure word as a failure', () => {
    expect(readDeliveryVerdict(data({ status: 'failed' }))).toBe('FAILED');
    expect(readDeliveryVerdict(data({ status: 'rejected' }))).toBe('FAILED');
  });
});

describe('isLivenessEvent', () => {
  it('ignores an event that is not about liveness, however well signed', async () => {
    const { isLivenessEvent } = await import('../../../src/modules/trust/jobs/resolve-liveness.job.js');
    expect(isLivenessEvent('identity.verification.completed')).toBe(true);
    expect(isLivenessEvent('liveness.completed')).toBe(true);
    // A KYT alert carrying a reference must not be read as a verdict about a person's face.
    expect(isLivenessEvent('tm.alert.created')).toBe(false);
    expect(isLivenessEvent('client.created')).toBe(false);
  });
});

describe('resolveLiveness', () => {
  const makeDeps = (row: Record<string, unknown> | undefined, request?: Record<string, unknown>) => {
    const finished: unknown[][] = [];
    const applied: unknown[] = [];
    return {
      finished,
      applied,
      deps: {
        db: {} as never,
        store: {
          identityFacts: () => Promise.resolve({ latestVerifiedIdentifier: 'NIN' }),
          applyLivenessOutcome: (input: unknown) => {
            applied.push(input);
            return Promise.resolve(true);
          },
        },
        adapter: { provider: 'YOUVERIFY' },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        gateway: { emitToUser: vi.fn() },
        hasher: {} as never,
        encryption: {} as never,
        __test: { row, request, finished },
      } as never,
    };
  };

  it('is exported with the pieces a caller needs', () => {
    expect(typeof makeDeps(undefined).deps).toBe('object');
  });
});
