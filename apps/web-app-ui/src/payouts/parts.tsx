// What the payout screens share: where they live, and the reference's bank row (`.bank-select-row`).
import { cx } from '@komtru/ui-kit';
import { bankBadge } from './format';

export const PAYOUTS_HREF = '/account/payouts';
export const WITHDRAW_HREF = '/account/payouts/withdraw';
export const BANK_HREF = '/account/payouts/bank';
export const payoutHref = (id: string): string => `/account/payouts/${id}`;

/**
 * `.bank-select-row`: the bank's badge, the account in bold and a line under it. `risk` is WF1's red edge and badge.
 * `trailing` is what sits on the right (a chip, a radio), and `children` anything under the row's text.
 */
export function BankRow({
  bankName,
  title,
  sub,
  risk = false,
  selected = false,
  trailing,
  className,
}: {
  bankName: string | null;
  title: string;
  sub?: React.ReactNode;
  risk?: boolean;
  selected?: boolean;
  trailing?: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cx(
        'mb-[8px] flex items-center gap-[12px] rounded-md border-[1.5px] border-solid bg-surface-primary px-[14px] py-[13px]',
        risk ? 'border-risk-soft' : selected ? 'border-trust-indigo' : 'border-border-hairline',
        className,
      )}
    >
      <span
        aria-hidden
        className={cx(
          'flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px] font-mono text-[10px] font-bold',
          risk ? 'bg-risk-soft text-risk-on-soft' : 'bg-surface-secondary text-slate',
        )}
      >
        {bankBadge(bankName)}
      </span>
      <span className="min-w-0">
        <b className="block text-[12.5px]">{title}</b>
        {sub !== undefined && <span className="block text-[10.5px] text-slate">{sub}</span>}
      </span>
      {trailing !== undefined && <span className="ml-auto shrink-0">{trailing}</span>}
    </div>
  );
}
