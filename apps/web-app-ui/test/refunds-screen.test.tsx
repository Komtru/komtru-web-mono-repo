// @vitest-environment jsdom
// F-044 (SP-M12): where's my refund. Built over `GET /me/refunds` and nothing else: each refund is a journey from what the
// ledger says, and with none there is an honest empty state.
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Refunds } from '../src/account/refunds/Refunds';
import { expectNoAxeViolations } from './axe';
import { problem } from './support/account';
import { SHELL_RULES, answerWith, id, refundRow, renderWithApi, type CallFn } from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
const setOnline = (online: boolean) =>
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });

beforeEach(() => {
  api.call.mockReset();
});
afterEach(() => {
  cleanup();
  setOnline(true);
});

const feed = (...items: unknown[]) => ({ 'GET /me/refunds': { items, nextCursor: null } });

describe('Where’s my refund? (SP-M12)', () => {
  it('shows a refund that came back as a finished journey, with the ledger’s own amount', async () => {
    answerWith(api.call, feed(refundRow('PROCESSED')));
    const { container } = renderWithApi(api.call, <Refunds />);
    expect(await screen.findByRole('heading', { name: 'Where’s my refund?' })).toBeDefined();
    const card = await screen.findByRole('article', { name: 'Refund refund-501' });
    expect(within(card).getByText('₦458,780')).toBeDefined();
    const steps = within(card).getByRole('list', { name: 'Where this refund is' });
    expect(steps.textContent).toContain('Refund requested');
    expect(steps.textContent).toContain('Back with you');
    expect(steps.textContent).toContain('To your original payment method');
    expect(within(card).getByText(/₦6,780 · Returned with your refund/)).toBeDefined();
    expect(within(card).getByRole('link', { name: 'View the Trade' }).getAttribute('href')).toBe(
      `/trade/${id(1)}`,
    );
    // No time the platform has not promised.
    expect(screen.queryByText(/Usually within|within 1 day|within 24/)).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('says a refund still moving is on its way, and does not say it arrived', async () => {
    answerWith(api.call, feed(refundRow('PROCESSING')));
    const { container } = renderWithApi(api.call, <Refunds />);
    const card = await screen.findByRole('article', { name: 'Refund refund-501' });
    expect(within(card).getByText('On its way back')).toBeDefined();
    // The last step is there to say what comes next, with no date, because nothing has come back yet.
    expect(within(card).getByText('Back with you').nextElementSibling).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('says a held refund is held, why, and what to quote', async () => {
    answerWith(
      api.call,
      feed(refundRow('NEEDS_REVIEW', { failureReason: 'The bank returned the transfer.' })),
    );
    const { container } = renderWithApi(api.call, <Refunds />);
    const card = await screen.findByRole('article', { name: 'Refund refund-501' });
    expect(within(card).getByText('Held while we check it')).toBeDefined();
    expect(within(card).getByText('The bank returned the transfer.')).toBeDefined();
    expect(within(card).getByText(/Quote refund-501 to support/)).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('does not state the fee as returned when the platform kept it', async () => {
    answerWith(
      api.call,
      feed(refundRow('PROCESSED', { feeAmountMinor: '0', buyerProtectionFeeTreatment: 'RETAIN' })),
    );
    renderWithApi(api.call, <Refunds />);
    const card = await screen.findByRole('article', { name: 'Refund refund-501' });
    expect(within(card).getByText(/Kept by Komtru/)).toBeDefined();
  });

  it('is honest when there is nothing: no refund, and no promise of one', async () => {
    answerWith(api.call, feed());
    const { container } = renderWithApi(api.call, <Refunds />);
    expect(await screen.findByText('No refunds')).toBeDefined();
    expect(
      screen.getByText(/A refund appears here if a Trade you paid for is cancelled or refunded/),
    ).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('shows loading, then an error with another go', async () => {
    api.call.mockImplementation(() => new Promise(() => undefined));
    const loading = renderWithApi(api.call, <Refunds />);
    expect(screen.getByRole('status', { name: 'Loading your refunds' })).toBeDefined();
    await expectNoAxeViolations(loading.container, SHELL_RULES);
    cleanup();
    answerWith(api.call, { 'GET /me/refunds': problem('INTERNAL', 500) });
    const failed = renderWithApi(api.call, <Refunds />);
    expect(await screen.findByText('Couldn’t load your refunds')).toBeDefined();
    await expectNoAxeViolations(failed.container, SHELL_RULES);
    answerWith(api.call, feed(refundRow('PROCESSED')));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('article', { name: 'Refund refund-501' })).toBeDefined();
  });

  it('says offline when the read fails with no network', async () => {
    setOnline(false);
    answerWith(api.call, { 'GET /me/refunds': new TypeError('Failed to fetch') });
    const { container } = renderWithApi(api.call, <Refunds />);
    expect(await screen.findByText('You’re offline')).toBeDefined();
    expect(screen.getByText(/Reconnect to see your refunds/)).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});
