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

// DX-12, TX-08 and DX-13: a screen that answers a proposal has no rail, and its response is its own region.
describe('ProposeWorkspace with a decision', () => {
  it('names the response as a region after the content, so a phone reads the offer first', () => {
    const { container } = render(
      <ProposeWorkspace decision={<button type="button">Accept</button>}>
        <p>The offer</p>
      </ProposeWorkspace>,
    );
    const response = screen.getByRole('region', { name: 'Your response' });
    expect(within(response).getByRole('button', { name: 'Accept' })).toBeTruthy();
    const offer = screen.getByText('The offer');
    expect(offer.compareDocumentPosition(response) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.innerHTML).not.toContain('200px');
  });

  it('reserves no rail column for a screen with neither a rail nor a preview', () => {
    const { container } = render(
      <ProposeWorkspace>
        <p>Plain stage</p>
      </ProposeWorkspace>,
    );
    expect(container.innerHTML).not.toContain('200px');
    expect(screen.queryByRole('navigation', { name: 'Trade assembly' })).toBeNull();
  });
});
