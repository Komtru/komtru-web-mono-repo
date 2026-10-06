// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Stepper } from '../../src/index.js';
import './setup.js';

const STEPS = ['Park Hub', 'Identity', 'Payout', 'Review', 'Submit'];

describe('Stepper', () => {
  it('numbers the steps, because the sequence is the content', () => {
    render(<Stepper steps={STEPS} current={0} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]?.textContent).toBe('1Park Hub');
    expect(items[4]?.textContent).toBe('5Submit');
  });

  it('marks exactly one step as the one the person is on', () => {
    const { container } = render(<Stepper steps={STEPS} current={2} />);
    const current = container.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe('3Payout');
  });

  it('draws one connector fewer than it has steps, so none trails off the end', () => {
    const { container } = render(<Stepper steps={STEPS} current={0} />);
    expect(container.querySelectorAll('.w-\\[32px\\]')).toHaveLength(4);
  });

  it('refuses a step outside the list', () => {
    expect(() => render(<Stepper steps={STEPS} current={5} />)).toThrow(RangeError);
  });
});
