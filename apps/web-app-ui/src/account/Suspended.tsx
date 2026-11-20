'use client';

import type { LifecycleStatus, Me } from '@komtru/api-client';
import { useMe } from '@komtru/api-client/react';
import {
  Banner,
  Button,
  EmptyState,
  ScreenColumn,
  SectionLabel,
  StatusHero,
  TermList,
  TermRow,
} from '@komtru/ui-kit';
import { ContactSupport } from './ContactSupport';
import { Loading, LoadProblem } from './states';

const ALERT_MARK = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16h.01" />
  </svg>
);

/** The states that put a person on this screen. An active, pending or closed account has nothing to say here. */
const RESTRICTED: readonly LifecycleStatus[] = ['RESTRICTED', 'SUSPENDED', 'LOCKED'];

const BUYER: Record<'SUSPENDED' | 'RESTRICTED' | 'LOCKED', { title: string; lead: string }> = {
  SUSPENDED: {
    title: 'Your account is suspended',
    lead: 'You can’t start new Trades right now. This follows a pattern our systems flagged — it isn’t a final decision.',
  },
  RESTRICTED: {
    title: 'Your account is restricted',
    lead: 'Some things are limited right now while we look at your account. It isn’t a final decision.',
  },
  LOCKED: {
    title: 'Your account is locked',
    lead: 'We’ve locked your account to keep it safe while we look into it. It isn’t a final decision.',
  },
};

const SELLER: Record<'SUSPENDED' | 'RESTRICTED' | 'LOCKED', { title: string; lead: string }> = {
  SUSPENDED: {
    title: 'Your selling is suspended',
    lead: 'Triggered by an unusual pattern of activity — under TrustOps review now.',
  },
  RESTRICTED: {
    title: 'Your selling is restricted',
    lead: 'Some things are limited right now while TrustOps looks at your account.',
  },
  LOCKED: {
    title: 'Your selling is locked',
    lead: 'We’ve locked your account to keep it safe — under TrustOps review now.',
  },
};

/**
 * AS1 (buyer) and AS2 (seller): the actual consequence of a Fraud Signal decision. What the platform sends is the
 * state and what the person can and cannot do (`abilities`); never the staff-written reason, which it deliberately
 * withholds, so this screen says what is paused and what is not and does not invent a cause. The reference's AS2 names
 * "new-account proposal activity" as the trigger; no account is told that here, because nothing says it is true.
 *
 * "Contact TrustOps" has no inbox to open yet, so it shows the reference to quote: the one thing support asks for.
 */
export function Suspended({ seller = false }: { seller?: boolean }): React.JSX.Element {
  const me = useMe();

  if (me.isPending) {
    return (
      <ScreenColumn>
        <Loading label="Checking your account" />
      </ScreenColumn>
    );
  }
  if (me.data === undefined) {
    return <LoadProblem what="your account" onRetry={() => void me.refetch()} />;
  }

  const account = me.data.account;
  if (!RESTRICTED.includes(account.status)) {
    return (
      <ScreenColumn>
        <EmptyState
          title={
            account.status === 'CLOSED' || account.status === 'ANONYMISED'
              ? 'This account is closed'
              : 'Nothing is holding your account'
          }
          body={
            account.status === 'CLOSED' || account.status === 'ANONYMISED'
              ? 'It can’t be used any more.'
              : 'Your account is in good standing. There’s nothing for you to do here.'
          }
          action={
            <Button asChild>
              <a href={seller ? '/trades' : '/home'}>{seller ? 'Back to your trades' : 'Back home'}</a>
            </Button>
          }
        />
      </ScreenColumn>
    );
  }

  const status = account.status as 'SUSPENDED' | 'RESTRICTED' | 'LOCKED';
  const words = (seller ? SELLER : BUYER)[status];

  return (
    <ScreenColumn>
      <StatusHero tone="risk" title={words.title}>
        {words.lead}
      </StatusHero>
      {stillWorks(account.abilities, seller) !== undefined && (
        <Banner tone="warning" icon={ALERT_MARK} title="What still works">
          {stillWorks(account.abilities, seller)}
        </Banner>
      )}
      {seller ? <SellerPaused abilities={account.abilities} /> : <BuyerNext />}
      <div className="mt-[16px]">
        <ContactSupport label="Contact TrustOps about this" reference={account.supportReference} />
      </div>
    </ScreenColumn>
  );
}

/**
 * What the platform says this person can still do, in their own terms, and nothing it does not say. The reference promises
 * more (escrow stays protected, a dispute can still be answered, "Existing Trades continue normally"); `abilities` carries
 * none of that, so it is not stated here: a banner that promised "ship or withdraw" above a table reading "Paused" was
 * the failure this replaces. Returns `undefined` when nothing is left to say (a locked account cannot sign in).
 */
export function stillWorks(abilities: Me['account']['abilities'], seller: boolean): string | undefined {
  const can: string[] = [];
  if (abilities.login) can.push(seller ? 'sign in and see your orders' : 'sign in and look around');
  if (abilities.withdraw) can.push('withdraw money already released to your balance');
  if (can.length === 0) return undefined;
  return `You can still ${can.join(' and ')}.`;
}

function BuyerNext(): React.JSX.Element {
  return (
    <section aria-label="What happens next">
      <SectionLabel>What happens next</SectionLabel>
      <TermList>
        <TermRow label="Review">Our TrustOps team is looking into this</TermRow>
        <TermRow label="Where it stands">This page always shows your account’s current state</TermRow>
      </TermList>
    </section>
  );
}

/** What a seller cannot do while this is open, from the platform's own `abilities` and not from the state's name. */
function SellerPaused({ abilities }: { abilities: Me['account']['abilities'] }): React.JSX.Element {
  const selling = abilities.sell ? 'Available' : 'Paused';
  return (
    <section aria-label="What’s paused and what isn’t">
      <SectionLabel>What’s paused and what isn’t</SectionLabel>
      <TermList>
        <TermRow label="Create listings">{selling}</TermRow>
        <TermRow label="Accept new Trade requests">{selling}</TermRow>
        <TermRow label="Withdraw funds">{abilities.withdraw ? 'Available' : 'Paused'}</TermRow>
      </TermList>
    </section>
  );
}
