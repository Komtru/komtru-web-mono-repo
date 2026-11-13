// @vitest-environment jsdom
// F-028 / CWT-S13: Evidence - Submit, drawn as a seam: the platform has no call to attach evidence to a trade.
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddEvidence } from '../src/trade/delivery/AddEvidence';
import { expectNoAxeViolations } from './axe';
import { SHELL_RULES, answerWith, id, renderWithApi, workspaceTrade, type CallFn } from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
afterEach(cleanup);
beforeEach(() => {
  api.call.mockReset();
});

describe('CWT-S13 add evidence', () => {
  it('says plainly it is not available and offers no control that cannot work', async () => {
    answerWith(api.call, { 'GET /trades/:id': workspaceTrade('INSPECTION', 'BUYER') });
    const { container } = renderWithApi(api.call, <AddEvidence id={id(1)} />);
    expect(await screen.findByText('Not in the app yet')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Add Evidence' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /submit/i })).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'View trade evidence' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/evidence`,
    );
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('shows loading and an error state', async () => {
    answerWith(api.call, { 'GET /trades/:id': new Error('down') });
    renderWithApi(api.call, <AddEvidence id={id(1)} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(await screen.findByText('Couldn’t load this trade')).toBeTruthy();
  });
});
