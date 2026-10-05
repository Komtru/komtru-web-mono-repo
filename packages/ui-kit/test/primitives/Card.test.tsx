// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card } from '../../src/index.js';
import './setup.js';

describe('Card', () => {
  it('renders what it is given', () => {
    render(<Card>iPhone 13 Pro, 256GB</Card>);
    expect(screen.getByText('iPhone 13 Pro, 256GB')).toBeDefined();
  });

  it('lays a thumbnail beside its copy in the reference’s item-card form', () => {
    const { container } = render(<Card layout="row">MacBook Air M2</Card>);
    expect(container.firstElementChild?.className).toContain('flex');
    expect(container.firstElementChild?.className).toContain('gap-[12px]');
  });

  it('is a plain block by default', () => {
    const { container } = render(<Card>Fee summary</Card>);
    expect(container.firstElementChild?.className).toContain('block');
  });
});
