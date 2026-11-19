// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProposeWorkspace } from '../src/trade/create/ProposeWorkspace';
import { expectNoAxeViolations } from './axe';

afterEach(cleanup);

/**
 * The propose and fund flow at three widths is one frame: the assembly rail, the working column and the contract
 * preview, arranged by CSS. These tests pin the structure (what is named, where it sits in the DOM and the
 * accessibility tree); the arrangement at each width is the visual check's job.
 */
describe('ProposeWorkspace', () => {
  it('names the assembly rail, the working column and the contract preview as three regions', () => {
    render(
      <ProposeWorkspace rail={<p>Rail steps</p>} preview={<p>Preview figures</p>}>
        <p>Working stage</p>
      </ProposeWorkspace>,
    );

    expect(
      within(screen.getByRole('navigation', { name: 'Trade assembly' })).getByText('Rail steps'),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('complementary', { name: 'Contract so far' })).getByText('Preview figures'),
    ).toBeTruthy();
    expect(screen.getByText('Working stage')).toBeTruthy();
  });

  it('draws no contract preview when the stage has nothing to preview, and the working column takes the width', () => {
    render(
      <ProposeWorkspace rail={<p>Rail steps</p>}>
        <p>Review stage</p>
      </ProposeWorkspace>,
    );

    expect(screen.queryByRole('complementary', { name: 'Contract so far' })).toBeNull();
    expect(screen.getByText('Review stage').closest('[data-propose-work]')).not.toBeNull();
  });

  it('has no accessibility violations with a preview', async () => {
    const { container } = render(
      <ProposeWorkspace rail={<p>Rail steps</p>} preview={<p>Preview figures</p>}>
        <h2>Item details</h2>
        <p>Working stage</p>
      </ProposeWorkspace>,
    );
    await expectNoAxeViolations(container);
  });
});
