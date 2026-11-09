// The copy for every trade notification (T-068). Which event sends which key, and to whom, is the
// trades module's `TRADE_NOTIFICATION_PLANS`; this file is only what each key SAYS. The mappings are
// derived from those plans, so a plan with no copy, or copy with no plan, cannot both exist.
//
// Every message is category TRADE: a user may opt out of a channel, and none is security-critical.
// Every one ends in the deep link, because the notification is a pointer: the detail is on the
// trade's screen, behind the party check. No price, address, PIN or staff-written reason appears here.
//
// IN_APP and PUSH carry the same short line; EMAIL is added only where money moved or a clock is
// about to, since those are the messages a person may need to find later.
export interface TradeCopy {
  /** The IN_APP and PUSH body. */
  short: string;
  /** Present where EMAIL is also sent. */
  email?: { subject: string; body: string };
  variables: string[];
}

const BASE = ['tradeCode', 'link'];

export const TRADE_COPY: Record<string, TradeCopy> = {
  'trades.proposal.received': {
    short: 'New trade proposal {{tradeCode}}. Review the terms and respond: {{link}}',
    variables: BASE,
  },
  'trades.proposal.countered': {
    short: 'Trade {{tradeCode}} has a counter-proposal waiting for you: {{link}}',
    variables: BASE,
  },
  'trades.proposal.accepted': {
    short: 'Trade {{tradeCode}} was accepted. {{nextStep}} {{link}}',
    variables: [...BASE, 'nextStep'],
  },
  'trades.proposal.declined': {
    short: 'Trade {{tradeCode}} was declined. {{link}}',
    variables: BASE,
  },
  'trades.proposal.rejected': {
    short: 'Trade {{tradeCode}} could not be sent after review. {{link}}',
    variables: BASE,
  },
  'trades.funded': {
    short: 'Trade {{tradeCode}} is funded. {{nextStep}} {{link}}',
    email: {
      subject: 'Trade {{tradeCode}} is funded',
      body: 'Trade {{tradeCode}} is funded.\n\n{{nextStep}}\n\nOpen the trade: {{link}}',
    },
    variables: [...BASE, 'nextStep'],
  },
  'trades.shipped': {
    short: 'Trade {{tradeCode}} is on its way to you. {{link}}',
    variables: BASE,
  },
  'trades.delivered': {
    short: 'Trade {{tradeCode}} was delivered. {{nextStep}} {{link}}',
    variables: [...BASE, 'nextStep'],
  },
  'trades.delivery.unconfirmed': {
    short: 'The seller says trade {{tradeCode}} was delivered. Please confirm you received it: {{link}}',
    variables: BASE,
  },
  'trades.delivery_extension.requested': {
    short: 'The seller asked for more time to deliver trade {{tradeCode}}. Accept or decline: {{link}}',
    variables: BASE,
  },
  'trades.delivery_extension.responded': {
    short: 'Trade {{tradeCode}}: {{outcomeLine}} {{link}}',
    variables: [...BASE, 'outcomeLine'],
  },
  'trades.delivery.overdue': {
    short: 'Delivery of trade {{tradeCode}} is overdue. {{nextStep}} {{link}}',
    email: {
      subject: 'Delivery of trade {{tradeCode}} is overdue',
      body: 'Delivery of trade {{tradeCode}} is overdue.\n\n{{nextStep}}\n\nOpen the trade: {{link}}',
    },
    variables: [...BASE, 'nextStep'],
  },
  'trades.inspection_extension.requested': {
    short: 'The buyer asked for more time to inspect trade {{tradeCode}}. Respond: {{link}}',
    variables: BASE,
  },
  'trades.inspection_extension.responded': {
    short: 'Trade {{tradeCode}}: {{outcomeLine}} {{link}}',
    variables: [...BASE, 'outcomeLine'],
  },
  'trades.inspection.reminder': {
    short:
      'Your inspection window for trade {{tradeCode}} closes {{dueAt}}. Confirm it, or raise an issue before then: {{link}}',
    email: {
      subject: 'Your inspection window for trade {{tradeCode}} is closing',
      body: 'Your inspection window for trade {{tradeCode}} closes {{dueAt}}.\n\nIf everything is as agreed, confirm and release payment. If not, raise an issue before the window closes; otherwise payment is released to the seller automatically.\n\nOpen the trade: {{link}}',
    },
    variables: [...BASE, 'dueAt'],
  },
  'trades.completed.confirmed': {
    short: 'The buyer confirmed trade {{tradeCode}}. Your payment is being released. {{link}}',
    variables: BASE,
  },
  'trades.completed.auto_released': {
    short: 'Trade {{tradeCode}} is complete. {{nextStep}} {{link}}',
    email: {
      subject: 'Trade {{tradeCode}} is complete',
      body: 'Trade {{tradeCode}} is complete.\n\n{{nextStep}}\n\nOpen the trade: {{link}}',
    },
    variables: [...BASE, 'nextStep'],
  },
  'trades.settled': {
    short: 'Payment for trade {{tradeCode}} has been released to you. {{link}}',
    email: {
      subject: 'Payment for trade {{tradeCode}} has been released',
      body: 'Payment for trade {{tradeCode}} has been released to your Komtru balance.\n\nOpen the trade: {{link}}',
    },
    variables: BASE,
  },
  'trades.cancelled': {
    short: 'Trade {{tradeCode}} was cancelled before payment. {{link}}',
    variables: BASE,
  },
  'trades.expired': {
    short: 'Trade {{tradeCode}} expired. {{link}}',
    variables: BASE,
  },
  'trades.refund.requested': {
    short: 'A refund was requested on trade {{tradeCode}}. {{reasonLine}} {{nextStep}} {{link}}',
    email: {
      subject: 'A refund was requested on trade {{tradeCode}}',
      body: 'A refund was requested on trade {{tradeCode}}.\n\n{{reasonLine}} {{nextStep}}\n\nOpen the trade: {{link}}',
    },
    variables: [...BASE, 'reasonLine', 'nextStep'],
  },
  'trades.refund.cancelled_refunded': {
    short: 'Trade {{tradeCode}} was cancelled and refunded. {{nextStep}} {{link}}',
    email: {
      subject: 'Trade {{tradeCode}} was cancelled and refunded',
      body: 'Trade {{tradeCode}} was cancelled and refunded.\n\n{{nextStep}}\n\nOpen the trade: {{link}}',
    },
    variables: [...BASE, 'nextStep'],
  },
};

export const tradeTemplates = (): unknown[] =>
  Object.entries(TRADE_COPY).flatMap(([templateKey, copy]) => [
    { templateKey, channel: 'IN_APP', category: 'TRADE', body: copy.short, variables: copy.variables },
    { templateKey, channel: 'PUSH', category: 'TRADE', body: copy.short, variables: copy.variables },
    ...(copy.email
      ? [
          {
            templateKey,
            channel: 'EMAIL',
            category: 'TRADE',
            subject: copy.email.subject,
            body: copy.email.body,
            variables: copy.variables,
          },
        ]
      : []),
  ]);
