// The words of each workspace state, for each side, as pure data: the screens draw what this returns and decide
// nothing about wording themselves, so the buyer's and the seller's sentences for one fact sit side by side
// here (and cannot drift) instead of in a dozen branches of a component. The rules for status, chips and
// actions are in `workspace-state.ts`.
import type { TradeRole, WorkspaceStatus } from './workspace-state';

export type BannerTone = 'ready' | 'note' | 'warn';

export interface Banner {
  tone: BannerTone;
  title: string;
  body: string;
}

/** What the words depend on besides the status and the side: values the screen already has, formatted. */
export interface CopyContext {
  /** "24 hours": the delivery grace period, when the trade has terms. */
  grace?: string | undefined;
  /** The item price, whole naira. */
  itemAmount?: string | undefined;
  /** What the seller receives, whole naira. */
  proceeds?: string | undefined;
  /** The other party's display name. */
  counterparty?: string | undefined;
  /** The agreed terms' version number. */
  version?: number | undefined;
}

export interface StateCopy {
  banner?: Banner;
  /** The centred ring and heading, for a state that is an occasion. */
  hero?: { title: string; body: string };
  /** "Ship by", "Inspection ends": the line before a deadline read from the platform. */
  deadlineLabel?: string;
  /** What the reader's payout is described as while the money is held. */
  payoutHeld?: string;
  /** The reader's own name for the other side's payout row. */
  payoutLabel?: string;
  /** A step that belongs to a later feature, said plainly with no control. */
  seam?: string;
  /** A closing line about what happens next. */
  nextStep?: string;
}

const NONE = {} satisfies StateCopy;

/** The shared "this is not in the app yet" voice, so the wording of a seam is one thing. */
export const notYet = (what: string): string => `${what} isn't in the app yet.`;

export function stateCopy(status: WorkspaceStatus, role: TradeRole, ctx: CopyContext = {}): StateCopy {
  const buyer = role === 'BUYER';
  const within = ctx.grace === undefined ? '' : ` within ${ctx.grace}`;
  switch (status) {
    case 'PENDING_PAYMENT':
      return {
        hero: {
          title: 'Terms agreed',
          body: 'Both parties accepted this version, so the trade has been created.',
        },
        banner: {
          tone: 'ready',
          title: 'Agreement recorded',
          body: `Version ${String(ctx.version ?? 1)} · accepted by buyer and seller. Payment hasn't been made.`,
        },
        nextStep: buyer
          ? "The next step is for you to fund the trade. Payment isn't available in the app yet, so there's nothing to do here until it is."
          : "The next step is for the buyer to fund the trade. You'll be told when they have.",
      };
    case 'FUNDED':
      return {
        banner: buyer
          ? {
              tone: 'ready',
              title: 'Your funds are protected',
              body: "Komtru is holding the payment. The seller can ship now, and you'll see it here the moment they do. No action needed from you.",
            }
          : {
              tone: 'ready',
              title: 'Prepare and dispatch',
              body: "Komtru has confirmed the buyer's funds are protected. Review the agreed details below, then hand the item over.",
            },
        deadlineLabel: buyer ? 'The seller ships by' : 'Ship by',
        payoutHeld: 'held, not yet released',
        ...(buyer ? {} : { seam: notYet('Marking the item shipped') }),
      };
    case 'SHIPPED':
      return {
        banner: buyer
          ? {
              tone: 'ready',
              title: 'Your item is in transit',
              body: 'The seller has dispatched the item. Keep the agreed terms to hand until it arrives.',
            }
          : {
              tone: 'ready',
              title: 'The item is on its way',
              body: 'You have dispatched the item. The buyer is asked to confirm when it arrives.',
            },
        payoutLabel: buyer ? 'Seller payout' : 'Your payout',
      };
    case 'UNCONFIRMED_DELIVERY':
      return {
        banner: buyer
          ? {
              tone: 'warn',
              title: 'Did it arrive?',
              body: `The seller says the item was delivered. Check you have it. If you don't answer${within}, the delivery is treated as confirmed and your inspection time starts.`,
            }
          : {
              tone: 'note',
              title: 'Waiting for the buyer to confirm',
              body: `You've reported the item delivered. If the buyer doesn't answer${within}, the delivery is treated as confirmed.`,
            },
        ...(buyer ? { seam: notYet('Confirming delivery') } : {}),
      };
    case 'INSPECTION':
      return {
        banner: buyer
          ? {
              tone: 'warn',
              title: 'Inspect the item',
              body: 'Compare what you received with the agreed terms. You can accept the item, report an issue or ask for more time.',
            }
          : {
              tone: 'note',
              title: 'The buyer is inspecting the item',
              body: 'If the window passes with no issue reported, the payment is released to you automatically.',
            },
        deadlineLabel: 'Inspection ends',
        seam: buyer
          ? "Accepting the item, asking for more time and reporting an issue aren't in the app yet."
          : notYet('Answering a request for more time'),
      };
    case 'DISPUTED':
      return {
        banner: {
          tone: 'warn',
          title: 'Issue reported — funds remain protected',
          body: buyer
            ? 'The issue is now a case. The payment stays held until it is decided against the agreed terms.'
            : 'The buyer reported an issue. The payment stays held until the case is decided against the agreed terms.',
        },
        payoutHeld: 'held while the case is open',
        seam: 'The case, and sending evidence to it, aren’t in the app yet.',
      };
    case 'COMPLETED':
      return {
        banner: {
          tone: 'note',
          title: 'Settlement is processing',
          body: 'The trade outcome is recorded. Komtru is carrying out the payment to the seller; it is not yet a completed payout.',
        },
      };
    case 'SETTLED': {
      const both = 'Both sides honoured the agreement in full.';
      return {
        hero: {
          title: 'Trade complete',
          body:
            ctx.itemAmount === undefined || ctx.proceeds === undefined
              ? both
              : buyer
                ? `${ctx.itemAmount} released${ctx.counterparty === undefined ? '' : ` to ${ctx.counterparty}`}. ${both}`
                : `${ctx.proceeds} released to you. ${both}`,
        },
      };
    }
    case 'RESOLVED_RELEASED':
      return outcome(
        'Decided: released to the seller',
        buyer
          ? 'The case was decided in the seller’s favour. The payment is released to them.'
          : 'The case was decided in your favour. The payment is released to you.',
      );
    case 'RESOLVED_REFUNDED':
      return outcome(
        'Decided: refunded to the buyer',
        buyer
          ? 'The case was decided in your favour. You are refunded.'
          : 'The case was decided in the buyer’s favour. They are refunded.',
      );
    case 'CANCELLED_REFUNDED':
      return outcome(
        'Cancelled and refunded',
        buyer
          ? 'The trade was cancelled after payment. You are refunded.'
          : 'The trade was cancelled after payment. The buyer is refunded.',
      );
    default:
      return NONE;
  }
}

/** A finished trade: the outcome, and that the money is confirmed separately. */
const outcome = (title: string, body: string): StateCopy => ({
  hero: { title, body },
  banner: {
    tone: 'note',
    title: '',
    body: 'The outcome is recorded. Komtru confirms the payment itself separately, so this is not a confirmation that the money has arrived.',
  },
});

/** The inspection window: what a request for more time means to each side. */
export const extensionPending = (role: TradeRole): Banner => ({
  tone: 'note',
  title: 'More inspection time was asked for',
  body:
    role === 'BUYER'
      ? 'You asked the seller for more time. The window stays as it is until they answer.'
      : 'The buyer asked for more inspection time. Your answer is needed.',
});

/**
 * A hold on the automatic release. The platform says only that the clock is stopped, and deliberately no more
 * (who placed it, or why, is Komtru's to keep), so neither does the screen.
 */
export const releasePaused: Banner = {
  tone: 'warn',
  title: 'Automatic release is paused',
  body: 'The inspection clock is stopped for now.',
};
