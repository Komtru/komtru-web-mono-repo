// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from '../../src/index.js';
import './setup.js';

describe('Skeleton', () => {
  it('is hidden from assistive technology — NodeLoader does the announcing', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shimmers with the reference gradient', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild?.className).toContain(
      'bg-[linear-gradient(90deg,var(--stone-gray)_25%,var(--cloud-gray)_50%,var(--stone-gray)_75%)]',
    );
    expect(container.firstElementChild?.className).toContain('animate-[shimmer_1.6s_ease-in-out_infinite]');
  });

  it('holds still for anyone who asked motion to stop', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild?.className).toContain('motion-reduce:animate-none');
  });

  it.each(['w40', 'w60', 'w80', 'full'] as const)('draws the %s line width', (width) => {
    const { container } = render(<Skeleton width={width} />);
    const expected = { w40: 'w-[40%]', w60: 'w-[60%]', w80: 'w-[80%]', full: 'w-full' }[width];
    expect(container.firstElementChild?.className).toContain(expected);
  });

  it('stacks placeholder lines when a block is being faked', () => {
    const { container } = render(<Skeleton lines={3} />);
    expect(container.firstElementChild?.children).toHaveLength(3);
  });
});
