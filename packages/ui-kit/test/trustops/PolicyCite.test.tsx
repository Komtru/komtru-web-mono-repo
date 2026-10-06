// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PolicyCite } from '../../src/index.js';
import '../primitives/setup.js';
import { expectNoAxeViolations } from './axe.js';

describe('PolicyCite', () => {
  it('prints the reference’s sentence, policy and section together', () => {
    render(<PolicyCite policy="New-Buyer Proposal Policy" section="2.1" />);
    expect(screen.getByText('Applied per New-Buyer Proposal Policy §2.1')).toBeDefined();
  });

  it('carries the reference’s trailing clause when one is given', () => {
    render(<PolicyCite policy="New-Buyer Proposal Policy" section="2.1" note="same threshold, every case" />);
    expect(
      screen.getByText('Applied per New-Buyer Proposal Policy §2.1 — same threshold, every case'),
    ).toBeDefined();
  });

  it('prints one § even when the caller supplies the sign', () => {
    render(<PolicyCite policy="Item Mismatch Policy" section="§4.1" />);
    expect(screen.getByText('Applied per Item Mismatch Policy §4.1')).toBeDefined();
  });

  it('is set in the mono face, because a citation has to be quotable', () => {
    const { container } = render(<PolicyCite policy="Velocity & Abuse Policy" section="2.4" />);
    expect(container.firstElementChild?.className).toContain('font-mono');
  });

  it('hides its icon from the accessibility tree', () => {
    const { container } = render(<PolicyCite policy="Business Verification Policy" section="1.4" />);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('passes axe', async () => {
    const { container } = render(
      <main>
        <PolicyCite policy="Park Hub Verification Policy" section="1.1" note="every case" />
      </main>,
    );
    await expectNoAxeViolations(container);
  });
});
