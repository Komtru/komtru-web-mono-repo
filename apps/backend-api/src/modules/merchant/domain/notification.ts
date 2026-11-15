// The sentence the applicant is sent for a decision. A notification template has no conditionals (M11 D5),
// so the three outcomes differ only in this line, as the geo city request does it. The reason is staff
// copy shown as written; the policy citation is internal and never leaves the platform.
import { labelFor } from './application.js';

export interface DecisionNotice {
  outcome: 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
  reason: string;
  requested: readonly { kind: 'DOCUMENT' | 'FIELD'; key: string }[];
}

export function decisionLine(notice: DecisionNotice): string {
  switch (notice.outcome) {
    case 'APPROVED':
      return 'Good news: you are now a certified Komtru merchant. Your shop is ready to set up.';
    case 'CHANGES_REQUESTED': {
      const named = notice.requested.map((item) => labelFor(item));
      const what = named.length > 0 ? ` Please update: ${named.join(', ')}.` : '';
      return `We need a few changes before we can approve it.${what} ${notice.reason}`.trim();
    }
    case 'REJECTED':
      return `We could not approve it. ${notice.reason}`.trim();
  }
}
