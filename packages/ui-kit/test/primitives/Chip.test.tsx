// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chip, type ChipTone } from '../../src/index.js';
import './setup.js';

const TONES: ChipTone[] = ['protected', 'awaiting', 'risk', 'resolved', 'verified'];

describe('Chip', () => {
  it.each(TONES)('carries the %s state', (tone) => {
    render(<Chip tone={tone}>Protected</Chip>);
    expect(screen.getByText('Protected')).toBeDefined();
  });

  it('draws the leading dot in the chip’s own colour', () => {
    const { container } = render(<Chip tone="protected">Protected</Chip>);
    const dot = container.querySelector('i');
    expect(dot?.className).toContain('bg-current');
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
  });

  it('drops the dot where the reference prints the label alone', () => {
    const { container } = render(
      <Chip tone="verified" dot={false}>
        Verified
      </Chip>,
    );
    expect(container.querySelector('i')).toBeNull();
  });

  it('is not interactive — a chip reports a state, it does not change one', () => {
    render(<Chip tone="risk">At risk</Chip>);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
