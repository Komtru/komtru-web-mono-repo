// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../primitives/setup.js';
import { axeConfiguration, axeOutcome, expectNoAxeViolations } from './axe.js';

/**
 * A check that cannot fail proves nothing, so the helper every other test in this ticket leans on is
 * itself held to a before-and-after: it has to reject markup axe should reject, and accept markup it
 * should accept.
 */
describe('expectNoAxeViolations', () => {
  it('rejects an image with no alternative text', async () => {
    const { container } = render(<img src="evidence.png" />);
    await expect(expectNoAxeViolations(container)).rejects.toThrow(/image-alt/);
  });

  it('rejects a control with no accessible name', async () => {
    const { container } = render(
      <div role="button" tabIndex={0}>
        {' '}
      </div>,
    );
    await expect(expectNoAxeViolations(container)).rejects.toThrow(/aria-command-name/);
  });

  it('names the failing node, not just the rule', async () => {
    const { container } = render(<img className="ev-thumb" src="evidence.png" />);
    await expect(expectNoAxeViolations(container)).rejects.toThrow(/ev-thumb/);
  });

  it('accepts markup with nothing wrong with it', async () => {
    const { container } = render(
      <section aria-label="Evidence">
        <img alt="Counter photo of the hub" src="evidence.png" />
        <button type="button">Request evidence</button>
      </section>,
    );
    await expect(expectNoAxeViolations(container)).resolves.toBeUndefined();
  });

  it('can be narrowed to the one rule a test is about', async () => {
    const { container } = render(<img src="evidence.png" />);
    await expect(expectNoAxeViolations(container, { runOnly: ['region'] })).resolves.toBeUndefined();
  });

  it('runs the landmark best-practice rules, which is what proves two regions are distinct', () => {
    expect(axeConfiguration.tags).toContain('best-practice');
  });

  it('turns off colour contrast, because jsdom paints nothing to sample', () => {
    expect(axeConfiguration.disabled).toEqual(['color-contrast']);
  });

  /**
   * "Needs review" is not "passed". The bucket is where jsdom-ambiguous results go — and also where
   * a real failure goes when axe cannot finish deciding: two panels sharing an id reported
   * `duplicate-id-aria` as `incomplete`, not as a violation, so ignoring this bucket let a genuine
   * bug through a whole suite.
   */
  it('fails on a check axe could not clear, not only on a violation', async () => {
    const { container } = render(
      <main>
        <p id="shared">first</p>
        <p id="shared">second</p>
        <button type="button" aria-describedby="shared">
          Approve
        </button>
      </main>,
    );
    await expect(expectNoAxeViolations(container)).rejects.toThrow(/could not clear/);
    await expect(
      expectNoAxeViolations(container, { allowIncomplete: ['duplicate-id-aria'] }),
    ).resolves.toBeUndefined();
  });

  it('reports a page-level rule as inapplicable when the run is scoped to a container', async () => {
    const { container } = render(<p>loose</p>);
    expect(await axeOutcome(container, 'region')).toBe('inapplicable');
  });
});
