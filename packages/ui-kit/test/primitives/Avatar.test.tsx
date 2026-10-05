// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from '../../src/index.js';
import './setup.js';

describe('Avatar', () => {
  it('upper-cases the initials and keeps two, the way every instance is written', () => {
    render(<Avatar initials="techedge" label="TechEdge NG" />);
    expect(screen.getByRole('img', { name: 'TechEdge NG' }).textContent).toBe('TE');
  });

  it('is decoration when the name it belongs to is already on screen', () => {
    const { container } = render(<Avatar initials="TE" />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it.each(['sm', 'md', 'lg'] as const)('draws the %s size the reference uses', (size) => {
    const { container } = render(<Avatar initials="ZF" size={size} />);
    const expected = { sm: 'h-[20px]', md: 'h-[34px]', lg: 'h-[44px]' }[size];
    expect(container.firstElementChild?.className).toContain(expected);
  });

  it.each(['info', 'warning', 'success'] as const)('fills with the %s pair', (tone) => {
    const { container } = render(<Avatar initials="ZF" tone={tone} />);
    const expected = {
      info: 'bg-trust-indigo-soft',
      warning: 'bg-warning-soft',
      success: 'bg-trust-emerald-soft',
    }[tone];
    expect(container.firstElementChild?.className).toContain(expected);
  });
});
