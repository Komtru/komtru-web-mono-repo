// The dedup key for a Paystack delivery (M8 D4). Paystack sends no event id, so one is derived from
// what identifies the event: its type and the provider's own id for the object it is about.
import { describe, expect, it } from 'vitest';
import { paystackEventId } from '../../../src/modules/ledger/infrastructure/providers/paystack/eventId.js';

const body = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8');

describe('paystackEventId', () => {
  it('is the event type and the data id', () => {
    expect(
      paystackEventId(body({ event: 'charge.success', data: { id: 302961, reference: 'fund-x' } })),
    ).toBe('charge.success:302961');
  });

  it('is the same for a redelivery whose other fields moved', () => {
    const first = body({ event: 'charge.success', data: { id: 302961, paid_at: 'a' } });
    const again = body({ event: 'charge.success', data: { paid_at: 'b', id: 302961 } });
    expect(paystackEventId(first)).toBe(paystackEventId(again));
  });

  it('separates two events about one object', () => {
    expect(paystackEventId(body({ event: 'refund.pending', data: { id: 7 } }))).not.toBe(
      paystackEventId(body({ event: 'refund.processed', data: { id: 7 } })),
    );
  });

  it('accepts a string id', () => {
    expect(paystackEventId(body({ event: 'transfer.success', data: { id: 'TRF_1' } }))).toBe(
      'transfer.success:TRF_1',
    );
  });

  it('falls back to a hash of the exact bytes when there is no id', () => {
    const id = paystackEventId(body({ event: 'charge.success', data: { reference: 'r' } }));
    expect(id).toMatch(/^charge\.success:sha256:[0-9a-f]{64}$/);
  });

  it('falls back to the hash for an id it cannot key on', () => {
    expect(paystackEventId(body({ event: 'charge.success', data: { id: null } }))).toMatch(
      /^charge\.success:sha256:/,
    );
  });

  it.each([
    ['not JSON', Buffer.from('nope')],
    ['not an envelope', body({ hello: 'world' })],
    ['an empty event type', body({ event: '', data: { id: 1 } })],
  ])('is null for a body that is %s', (_label, raw) => {
    expect(paystackEventId(raw)).toBeNull();
  });
});
