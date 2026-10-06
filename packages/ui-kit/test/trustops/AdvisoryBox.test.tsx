// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ADVISORY_LABEL, AdvisoryBox } from '../../src/index.js';
import '../primitives/setup.js';
import { expectNoAxeViolations } from './axe.js';

const ADVICE =
  'Unverified number plus first-Trade amount 34x the median matches the pattern behind 70% of ' +
  'proposals later confirmed as social-engineering attempts. Suggest: require phone verification ' +
  'before this reaches the seller.';

/** Anything a keyboard or a screen reader could operate. */
const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex],[role="button"],[role="link"]';

describe('AdvisoryBox', () => {
  it('is a landmark named exactly "AI-suggested — not a decision"', () => {
    render(<AdvisoryBox>{ADVICE}</AdvisoryBox>);
    expect(screen.getByRole('region', { name: ADVISORY_LABEL })).toBeDefined();
    expect(ADVISORY_LABEL).toBe('AI-suggested — not a decision');
  });

  it('shows the label as well as announcing it, in the reference’s uppercase treatment', () => {
    const { container } = render(<AdvisoryBox>{ADVICE}</AdvisoryBox>);
    const label = container.querySelector('p');
    expect(label?.textContent).toBe(ADVISORY_LABEL);
    expect(label?.className).toContain('uppercase');
  });

  it('contains no control a reader could operate — the advice cannot be acted on from inside it', () => {
    render(<AdvisoryBox>{ADVICE}</AdvisoryBox>);
    const advisory = screen.getByRole('region', { name: ADVISORY_LABEL });
    expect(advisory.querySelectorAll(FOCUSABLE)).toHaveLength(0);
    expect(within(advisory).queryAllByRole('button')).toHaveLength(0);
    expect(within(advisory).queryAllByRole('link')).toHaveLength(0);
  });

  it('renders one paragraph per entry when given several', () => {
    render(
      <AdvisoryBox>{['Identity and hub details are consistent.', 'Authority is the gap.']}</AdvisoryBox>,
    );
    const advisory = screen.getByRole('region', { name: ADVISORY_LABEL });
    // One for the label, one for each piece of advice.
    expect(advisory.querySelectorAll('p')).toHaveLength(3);
  });

  it('refuses a React element at runtime, which is how a button would get in', () => {
    const smuggled = [<button key="x">Approve</button>] as unknown as readonly string[];
    expect(() => render(<AdvisoryBox>{smuggled}</AdvisoryBox>)).toThrow(/prose only/);
  });

  /**
   * `<section aria-label="">` has no accessible name, and a `<section>` without one is not a region
   * landmark at all — so a blank label deletes the semantic half of the separation while leaving
   * the dashed border that makes it look intact. The package teaches the empty-string-drops-it
   * convention one file away on `TrustTrail`'s caption, which is precisely why this has to say no.
   */
  it('refuses a blank label, which would silently delete the landmark', () => {
    expect(() => render(<AdvisoryBox label="">{ADVICE}</AdvisoryBox>)).toThrow(/cannot be unnamed/);
    expect(() => render(<AdvisoryBox label="   ">{ADVICE}</AdvisoryBox>)).toThrow(/cannot be unnamed/);
  });

  it('refuses to render with no advice at all', () => {
    expect(() => render(<AdvisoryBox>{[]}</AdvisoryBox>)).toThrow(/no advice/);
  });

  it('takes a different label for a non-AI advisory, but still names the landmark', () => {
    render(<AdvisoryBox label="Policy-engine suggestion — not a decision">{ADVICE}</AdvisoryBox>);
    expect(screen.getByRole('region', { name: 'Policy-engine suggestion — not a decision' })).toBeDefined();
  });

  it('draws the reference’s dashed indigo treatment', () => {
    render(<AdvisoryBox>{ADVICE}</AdvisoryBox>);
    const advisory = screen.getByRole('region', { name: ADVISORY_LABEL });
    expect(advisory.className).toContain('border-dashed');
    expect(advisory.className).toContain('border-trust-indigo');
    expect(advisory.className).toContain('bg-trust-indigo-soft');
  });

  it('passes axe', async () => {
    const { container } = render(
      <main>
        <AdvisoryBox>{ADVICE}</AdvisoryBox>
      </main>,
    );
    await expectNoAxeViolations(container);
  });
});
