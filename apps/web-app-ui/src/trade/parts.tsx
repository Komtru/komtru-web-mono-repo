'use client';

// The pieces every trade screen shares: the party strip, the item card, the terms rows and the confirmation a
// withdrawal goes through. They were private to `TradeScreen` while only the proposal used them; the workspace
// reads the same trade with the same parts, so they live here and both import them (one way of drawing a term,
// not two that drift).
import type { TradeView } from '@komtru/api-client';
import { Button, ItemCard, PartyStrip, Sheet, TermList, TermRow, type VersionStep } from '@komtru/ui-kit';
import {
  addressLine,
  hoursLabel,
  initialsOf,
  itemSub,
  itemTitle,
  naira,
  partyName,
  whenLabel,
} from './format';

/**
 * Who is on the other side, from the trade itself. The platform sends nothing for a proposal still waiting
 * for an invitee, or for an erased or closed account, and then no strip is drawn.
 */
export function PartyHeader({ trade }: { trade: TradeView }): React.JSX.Element | null {
  const party = trade.counterparty;
  if (party === undefined || party === null) return null;
  const name = partyName(party);
  return <PartyStrip name={name} initials={initialsOf(name.replace(/^@/, ''))} />;
}

export function ItemSummary({ trade }: { trade: TradeView }): React.JSX.Element | null {
  if (trade.terms === null) return null;
  const sub = itemSub(trade.terms.itemSpec);
  return (
    <ItemCard
      title={itemTitle(trade.terms.itemSpec)}
      {...(sub === undefined ? {} : { sub })}
      price={naira(trade.terms.itemAmountMinor)}
    />
  );
}

export function TermsRows({ trade }: { trade: TradeView }): React.JSX.Element | null {
  const { terms } = trade;
  if (terms === null) return null;
  const delivery = terms.deliveryAddress === null ? undefined : addressLine(terms.deliveryAddress);
  const shipsFrom = terms.shipsFromAddress === null ? undefined : addressLine(terms.shipsFromAddress);
  return (
    <TermList aria-label="Terms of this trade">
      <TermRow label="Price" checked>
        {naira(terms.itemAmountMinor)}
      </TermRow>
      <TermRow label="Inspection" checked>
        {hoursLabel(terms.inspectionWindowHours)}
        <span className="font-semibold text-info-on-soft"> · Trade Standard</span>
      </TermRow>
      {delivery !== undefined && (
        <TermRow label="Delivery to" checked>
          {delivery}
        </TermRow>
      )}
      {shipsFrom !== undefined && (
        <TermRow label="Ships from" checked>
          {shipsFrom}
        </TermRow>
      )}
      <TermRow label="Version" checked>
        {String(terms.versionNumber)}
      </TermRow>
      {trade.acceptedAt !== null && <TermRow label="Accepted">{whenLabel(trade.acceptedAt)}</TermRow>}
    </TermList>
  );
}

export const BACK_TO_TRADES = (
  <Button asChild variant="secondary">
    <a href="/trades">Back to your trades</a>
  </Button>
);

/** The confirmation every withdrawal goes through: a decision that cannot be undone asks once. */
export function ConfirmSheet({
  open,
  title,
  confirm,
  pending,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  confirm: string;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button type="button" variant="danger" onClick={onConfirm} disabled={pending}>
            {pending ? 'Working…' : confirm}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Keep it
          </Button>
        </>
      }
    >
      {children}
    </Sheet>
  );
}

/**
 * The versions this agreement went through. The platform returns only the current terms, so only the
 * current version is described (who proposed it is the API's own `proposedByRole`); the ones before
 * it are listed as superseded without saying who wrote them, because that is not something the
 * screen is told.
 */
export function versionSteps(trade: TradeView): VersionStep[] {
  const current = trade.terms?.versionNumber ?? 1;
  const proposer = trade.terms?.proposedByRole === 'SELLER' ? 'seller' : 'buyer';
  return Array.from({ length: current }, (_, index) => {
    const n = index + 1;
    return n === current
      ? {
          id: String(n),
          title: `Version ${String(n)} · Accepted`,
          detail: `Proposed by the ${proposer}. Current agreed version`,
          state: 'done' as const,
        }
      : { id: String(n), title: `Version ${String(n)}`, detail: 'Superseded', state: 'done' as const };
  });
}
