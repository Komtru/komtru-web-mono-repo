// @vitest-environment jsdom
// The dispute screens (F-032, T-120 and T-196).
//
// `answerWith` parses every fixture through the endpoint's own response schema, so a fixture that
// drifts from the contract fails here rather than passing a green test against a shape the
// platform never sends.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Appeal } from '../src/trade/dispute/Appeal';
import { CaseStatus } from '../src/trade/dispute/CaseStatus';
import { DisputeScreen, WithDispute } from '../src/trade/dispute/DisputeScreen';
import { EvidenceComparison } from '../src/trade/dispute/EvidenceComparison';
import { SellerNotice } from '../src/trade/dispute/SellerNotice';
import { Withdraw } from '../src/trade/dispute/Withdraw';
import { expectNoAxeViolations } from './axe';
import { answerWith, callsTo, id, renderWithApi, workspaceTrade } from './support/workspace';
import type { CallFn } from './support/trade';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

const TRADE = id(1);
const CASE = id(50);
const BUYER = id(11);
const SELLER = id(12);

const dispute = (over: Record<string, unknown> = {}) => ({
  id: CASE,
  disputeNumber: 88_213,
  code: 'DIS-088213',
  tradeId: TRADE,
  orderId: null,
  status: 'MEDIATION',
  category: 'ITEM_NOT_AS_DESCRIBED',
  creationPath: 'DIRECT_FILING',
  openedReason: 'The listing said Sierra Blue but I received a Midnight black unit.',
  openedByUserId: BUYER,
  buyerUserId: BUYER,
  sellerUserId: SELLER,
  totalEscrowMinor: '45200000',
  window: {
    kind: 'MEDIATION',
    deadlineAt: '2026-11-21T09:00:00.000Z',
    remaining: { hours: 31, minutes: 0, expired: false },
  },
  mediationDeadlineAt: '2026-11-21T09:00:00.000Z',
  evidenceDeadlineAt: '2026-11-24T09:00:00.000Z',
  evidenceReopenedAt: null,
  decidedAt: null,
  appealDeadlineAt: null,
  appealFiledAt: null,
  closedAt: null,
  createdAt: '2026-11-19T09:00:00.000Z',
  ...over,
});

const detail = (over: Record<string, unknown> = {}) => ({
  ...dispute(over),
  yourRole: 'BUYER',
  decisions: [],
  proposals: [],
  ...over,
});

const decision = (over: Record<string, unknown> = {}) => ({
  id: '7',
  disputeId: CASE,
  decisionType: 'ORIGINAL',
  decidedByUserId: id(13),
  outcome: 'REFUND_BUYER_FULL',
  amountToBuyerMinor: '45200000',
  amountToSellerMinor: '0',
  appealOutcome: null,
  rationale: 'The delivered item’s colour did not match the listing as agreed in §2.',
  agreedNote: null,
  decidedAt: '2026-11-25T12:00:00.000Z',
  ...over,
});

const comparison = (over: Record<string, unknown> = {}) => ({
  disputeId: CASE,
  tradeId: TRADE,
  seller: { role: 'SELLER', userId: SELLER, fromTrade: [], fromDispute: [] },
  buyer: { role: 'BUYER', userId: BUYER, fromTrade: [], fromDispute: [] },
  custody: [],
  timeline: [],
  mediation: { deadlineAt: '2026-11-21T09:00:00.000Z', remaining: { hours: 31, minutes: 0, expired: false } },
  ...over,
});

const serve = (over: Record<string, unknown> = {}) =>
  answerWith(api.call, {
    'GET /trades/:id': workspaceTrade('DISPUTED', 'BUYER'),
    'GET /trades/:id/dispute': dispute(),
    'GET /disputes/:id': detail(),
    'GET /disputes/:id/evidence-comparison': comparison(),
    ...over,
  });

beforeEach(() => {
  api.call.mockReset();
});

// Vitest is configured without globals, so Testing Library does not auto-clean; without this a
// screen from the previous test is still in the document and every text query finds two.
afterEach(cleanup);

describe('reporting an issue (Customer-7, CWT-S14)', () => {
  it('offers the buyer the form, and will not file until a reason is chosen', async () => {
    serve({ 'GET /trades/:id': workspaceTrade('INSPECTION', 'BUYER'), 'GET /trades/:id/dispute': null });
    const { container } = renderWithApi(api.call, <DisputeScreen id={TRADE} />);

    await screen.findByText(/stays protected while this is reviewed/);
    const submit = screen.getByRole('button', { name: 'Continue to issue review' });
    // Nothing is pre-selected: a category is recorded on a financial case, so it is never assumed.
    expect(submit).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByLabelText('Arrived damaged'));
    expect(submit).toHaveProperty('disabled', false);
    await expectNoAxeViolations(container);
  });

  it('files under the category the chosen reason maps to', async () => {
    serve({
      'GET /trades/:id': workspaceTrade('INSPECTION', 'BUYER'),
      'GET /trades/:id/dispute': null,
      'POST /trades/:id/dispute': dispute(),
    });
    renderWithApi(api.call, <DisputeScreen id={TRADE} />);
    await screen.findByText(/stays protected while this is reviewed/);

    fireEvent.click(screen.getByLabelText('Item or parts missing'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to issue review' }));

    await waitFor(() => {
      expect(callsTo(api.call, 'POST', '/trades/:id/dispute')[0]).toMatchObject({
        body: { category: 'ITEM_NOT_RECEIVED' },
      });
    });
  });

  it('tells the seller there is nothing to answer, with no control to press', async () => {
    serve({ 'GET /trades/:id': workspaceTrade('INSPECTION', 'SELLER'), 'GET /trades/:id/dispute': null });
    renderWithApi(api.call, <DisputeScreen id={TRADE} />);
    await screen.findByText(/There is no issue open on this trade/);
    expect(screen.queryByRole('radio')).toBeNull();
  });
});

describe('where the case stands (Customer-8, CWT-S15)', () => {
  it('shows the case, the money that has not moved, and the step rail', async () => {
    serve();
    const { container } = renderWithApi(api.call, <CaseStatus id={TRADE} disputeId={CASE} />);

    await screen.findByText('DIS-088213');
    expect(screen.getByText('Under Review')).toBeTruthy();
    expect(screen.getByText('Still protected — no funds have moved')).toBeTruthy();

    // TermList renders a <dl>, which carries no implicit list role, so the rows are read by text.
    expect(screen.getByText('Not issued')).toBeTruthy();
    expect(screen.getByText('Held')).toBeTruthy();

    await expectNoAxeViolations(container);
  });

  it('offers the withdrawal only to the person who opened it', async () => {
    serve();
    renderWithApi(api.call, <CaseStatus id={TRADE} disputeId={CASE} />);
    await screen.findByText('DIS-088213');
    expect(screen.getByRole('link', { name: 'Withdraw the dispute' })).toBeTruthy();
  });

  it('does not offer the withdrawal to the other party', async () => {
    serve({ 'GET /disputes/:id': detail({ yourRole: 'SELLER', openedByUserId: BUYER }) });
    renderWithApi(api.call, <CaseStatus id={TRADE} disputeId={CASE} />);
    await screen.findByText('DIS-088213');
    expect(screen.queryByRole('link', { name: 'Withdraw the dispute' })).toBeNull();
  });
});

describe('the outcome, both sides (H1 and H2)', () => {
  const decided = (role: 'BUYER' | 'SELLER') =>
    detail({
      status: 'DECIDED',
      yourRole: role,
      decidedAt: '2026-11-25T12:00:00.000Z',
      appealDeadlineAt: '2026-12-02T12:00:00.000Z',
      window: {
        kind: 'APPEAL',
        deadlineAt: '2026-12-02T12:00:00.000Z',
        remaining: { hours: 160, minutes: 0, expired: false },
      },
      decisions: [decision()],
    });

  it('H1: gives the buyer the outcome, the reasoning and the timeline', async () => {
    serve({ 'GET /disputes/:id': decided('BUYER') });
    const { container } = renderWithApi(api.call, <CaseStatus id={TRADE} disputeId={CASE} />);

    await screen.findByText('Refund issued in full');
    expect(screen.getByText(/colour did not match the listing/)).toBeTruthy();
    expect(screen.getByLabelText('How this case was decided')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'File an appeal' })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('H1: does not say the case is still awaiting a response once it is decided', async () => {
    serve({ 'GET /disputes/:id': decided('BUYER') });
    renderWithApi(api.call, <CaseStatus id={TRADE} disputeId={CASE} />);
    await screen.findByText('Refund issued in full');
    expect(screen.queryByText('Awaiting the other side’s response')).toBeNull();
    expect(screen.getByText('The response window closed')).toBeTruthy();
  });

  it('H2: gives the seller a corrective framing, no reasoning card and no timeline', async () => {
    serve({ 'GET /disputes/:id': decided('SELLER') });
    const { container } = renderWithApi(api.call, <CaseStatus id={TRADE} disputeId={CASE} />);

    await screen.findByText(/Refund issued to/);
    expect(screen.getByText(/wasn't ruled against you personally/)).toBeTruthy();
    expect(screen.getByText('Corrective')).toBeTruthy();
    expect(screen.getByText('Event type — not Negative')).toBeTruthy();
    // The asymmetry is the point: no decision card and no step rail on the seller's side.
    expect(screen.queryByText(/colour did not match the listing/)).toBeNull();
    expect(screen.queryByLabelText('How this case was decided')).toBeNull();
    await expectNoAxeViolations(container);
  });
});

describe('the seller’s notice (Seller-7)', () => {
  it('quotes the buyer and attributes it, without taking a side', async () => {
    serve({
      'GET /trades/:id': workspaceTrade('DISPUTED', 'SELLER'),
      'GET /disputes/:id': detail({ yourRole: 'SELLER' }),
    });
    const { container } = renderWithApi(api.call, <SellerNotice id={TRADE} disputeId={CASE} />);

    await screen.findByText(/Sierra Blue but I received a Midnight black unit/);
    expect(screen.getByText(/This isn’t a penalty/)).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('refuses the buyer, with the reason and a way back', async () => {
    serve({ 'GET /trades/:id': workspaceTrade('DISPUTED', 'BUYER') });
    renderWithApi(api.call, <SellerNotice id={TRADE} disputeId={CASE} />);
    await screen.findByText(/seller's view of the case/);
  });

  it('sends "Respond with evidence" to the seller’s response screen (Seller-8), not the comparison', async () => {
    serve({
      'GET /trades/:id': workspaceTrade('DISPUTED', 'SELLER'),
      'GET /disputes/:id': detail({ yourRole: 'SELLER' }),
    });
    renderWithApi(api.call, <SellerNotice id={TRADE} disputeId={CASE} />);
    const link = await screen.findByRole('link', { name: 'Respond with evidence' });
    expect(link.getAttribute('href')).toBe(`/trade/${TRADE}/dispute/respond`);
  });
});

describe('the item the case is about (Seller-7, DI-01)', () => {
  it('names the item on the seller’s notice, not the trade code', async () => {
    serve({
      'GET /trades/:id': workspaceTrade('DISPUTED', 'SELLER'),
      'GET /disputes/:id': detail({ yourRole: 'SELLER' }),
    });
    renderWithApi(api.call, <SellerNotice id={TRADE} disputeId={CASE} />);
    await screen.findByText('Apple iPhone 13 Pro');
  });

  it('names the affected item on the issue review, not the trade code', async () => {
    serve();
    renderWithApi(api.call, <WithDispute id={TRADE} screen="issue" />);
    await screen.findByText('Apple iPhone 13 Pro');
  });
});

describe('the seller’s response (Seller-8)', () => {
  it('is reachable by its route key and asks the seller what happened', async () => {
    serve({
      'GET /trades/:id': workspaceTrade('DISPUTED', 'SELLER'),
      'GET /disputes/:id': detail({ yourRole: 'SELLER' }),
    });
    const { container } = renderWithApi(api.call, <WithDispute id={TRADE} screen="respond" />);
    await screen.findByText('What actually happened?');
    expect(screen.getByRole('button', { name: 'Submit response' }).hasAttribute('disabled')).toBe(true);
    await expectNoAxeViolations(container);
  });
});

describe('the evidence comparison (Y1)', () => {
  it('draws both panels even when one side has added nothing', async () => {
    serve();
    const { container } = renderWithApi(api.call, <EvidenceComparison id={TRADE} disputeId={CASE} />);

    await screen.findByText('Seller’s pre-shipment proof');
    expect(screen.getByText('Buyer’s unboxing photos')).toBeTruthy();
    // An omitted empty panel would read as "they submitted nothing", which is an accusation.
    expect(screen.getAllByText('Nothing added yet')).toHaveLength(2);
    await expectNoAxeViolations(container);
  });

  it('shows the 48-hour auto-escalation strip while mediation is open', async () => {
    serve();
    renderWithApi(api.call, <EvidenceComparison id={TRADE} disputeId={CASE} />);
    await screen.findByText('Auto-escalates to TrustOps in 31h if not mutually resolved');
  });

  it('refuses a partial settlement rather than sending an offer it cannot price', async () => {
    serve();
    renderWithApi(api.call, <EvidenceComparison id={TRADE} disputeId={CASE} />);
    await screen.findByText('Seller’s pre-shipment proof');

    fireEvent.click(screen.getByLabelText('Partial settlement'));
    expect(screen.getByRole('button', { name: 'Submit for mediation' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/isn’t in the app yet/)).toBeTruthy();
  });

  it('sends a full refund with return as the money outcome plus the agreed words', async () => {
    serve({
      'POST /disputes/:id/mediation/proposals': {
        ...decision(),
        id: id(60),
        disputeId: CASE,
        proposedByUserId: BUYER,
        note: null,
        status: 'PROPOSED',
        respondedByUserId: null,
        respondedAt: null,
        createdAt: '2026-11-19T10:00:00.000Z',
      },
    });
    renderWithApi(api.call, <EvidenceComparison id={TRADE} disputeId={CASE} />);
    await screen.findByText('Seller’s pre-shipment proof');

    fireEvent.click(screen.getByLabelText('Full refund with return'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit for mediation' }));

    await waitFor(() => {
      expect(callsTo(api.call, 'POST', '/disputes/:id/mediation/proposals')).toHaveLength(1);
    });
    const sent = callsTo(api.call, 'POST', '/disputes/:id/mediation/proposals')[0] as {
      body: { outcome: string; amountToBuyerMinor: string; amountToSellerMinor: string; note: string };
    };
    expect(sent.body.outcome).toBe('REFUND_BUYER_FULL');
    expect(sent.body.amountToBuyerMinor).toBe('45200000');
    expect(sent.body.amountToSellerMinor).toBe('0');
    // Q10: the return arrangement survives as the agreed words beside the money outcome.
    expect(sent.body.note).toContain('self-arranged');
  });
});

describe('appealing (AC6)', () => {
  it('will not open an appeal on a case that has not been decided', async () => {
    serve();
    renderWithApi(api.call, <Appeal id={TRADE} disputeId={CASE} />);
    await screen.findByText(/no decision to appeal yet/);
  });

  it('will not open a second appeal', async () => {
    serve({
      'GET /disputes/:id': detail({
        status: 'DECIDED',
        decidedAt: '2026-11-25T12:00:00.000Z',
        appealFiledAt: '2026-11-26T12:00:00.000Z',
        decisions: [decision()],
      }),
    });
    renderWithApi(api.call, <Appeal id={TRADE} disputeId={CASE} />);
    await screen.findByText(/already been appealed/);
  });

  it('takes the appeal and states the rule the platform enforces', async () => {
    serve({
      'GET /disputes/:id': detail({
        status: 'DECIDED',
        decidedAt: '2026-11-25T12:00:00.000Z',
        appealDeadlineAt: '2026-12-02T12:00:00.000Z',
        decisions: [decision()],
      }),
      'POST /disputes/:id/appeal': dispute({ status: 'APPEALED' }),
    });
    const { container } = renderWithApi(api.call, <Appeal id={TRADE} disputeId={CASE} />);

    await screen.findByText(/One appeal per case, reviewed by a specialist/);
    const submit = screen.getByRole('button', { name: 'Submit appeal' });
    expect(submit).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText('What specifically do you disagree with?'), {
      target: { value: 'The unit was still sealed on arrival.' },
    });
    expect(submit).toHaveProperty('disabled', false);
    await expectNoAxeViolations(container);
  });
});

describe('withdrawing (SP-M23)', () => {
  it('states the consequences before it offers the button', async () => {
    serve();
    const { container } = renderWithApi(api.call, <Withdraw id={TRADE} disputeId={CASE} />);

    await screen.findByText('Withdraw this dispute?');
    expect(screen.getByText('Only do this if it has really been sorted out.')).toBeTruthy();
    expect(screen.getByText('The dispute closes')).toBeTruthy();
    expect(screen.getByText(/can’t be reopened after that/)).toBeTruthy();

    expect(screen.getByRole('button', { name: 'Withdraw the dispute' })).toHaveProperty('disabled', true);
    await expectNoAxeViolations(container);
  });

  it('refuses anyone but the person who opened it', async () => {
    serve({ 'GET /disputes/:id': detail({ yourRole: 'SELLER', openedByUserId: BUYER }) });
    renderWithApi(api.call, <Withdraw id={TRADE} disputeId={CASE} />);
    await screen.findByText(/Only the person who opened this dispute can withdraw it/);
  });

  it('refuses once the case is past mediation', async () => {
    serve({ 'GET /disputes/:id': detail({ status: 'UNDER_REVIEW' }) });
    renderWithApi(api.call, <Withdraw id={TRADE} disputeId={CASE} />);
    await screen.findByText(/past the point where it can be withdrawn/);
  });
});

describe('states every data-backed screen owes', () => {
  it('says the case could not be read, and offers a retry', async () => {
    serve({ 'GET /disputes/:id': new Error('boom') });
    renderWithApi(api.call, <CaseStatus id={TRADE} disputeId={CASE} />);
    await screen.findByRole('button', { name: /try again/i });
  });

  it('says plainly when there is no case rather than drawing an empty screen', async () => {
    serve({ 'GET /trades/:id/dispute': null, 'GET /trades/:id': workspaceTrade('DISPUTED', 'SELLER') });
    renderWithApi(api.call, <DisputeScreen id={TRADE} />);
    await screen.findByText(/There is no issue open on this trade/);
  });
});

describe('the case routes draw the screen they name', () => {
  // A route names its screen by key, because a server page cannot pass a component into this client module.
  it.each([
    ['issue', /^Report an Issue$/],
    ['status', /^Dispute$/],
    ['evidence', /^Evidence · /],
    ['withdraw', /^Withdraw$/],
    ['appeal', /^File an Appeal$/],
  ] as const)('%s draws its screen', async (screenKey, title) => {
    serve();
    renderWithApi(api.call, <WithDispute id={TRADE} screen={screenKey} />);
    await screen.findAllByText(title);
  });
});
