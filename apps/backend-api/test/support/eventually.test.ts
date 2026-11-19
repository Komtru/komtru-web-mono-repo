// The timeout message must name the state the wait gave up on; the bare form is what hid cause 3.
import { describe, expect, it, vi } from 'vitest';
import { eventually } from './eventually.js';

describe('eventually', () => {
  it('reports the state it gave up on when the describe callback is given', async () => {
    await expect(
      eventually(
        () => false,
        30,
        () => 'queue notify.sms: 2 waiting',
      ),
    ).rejects.toThrow('condition not met in 30ms — queue notify.sms: 2 waiting');
  });

  it('does not call describe when the condition holds', async () => {
    const describe = vi.fn(() => 'never');
    await eventually(() => true, 30, describe);
    expect(describe).not.toHaveBeenCalled();
  });
});
