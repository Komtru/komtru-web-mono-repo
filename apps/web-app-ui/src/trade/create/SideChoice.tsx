import { Button, ScreenColumn, ScreenHeader, cx } from '@komtru/ui-kit';

/** Which side of a new trade the person creating it is on. */
export type TradeSide = 'buy' | 'sell';

/** `?side=` as typed in a link, or `undefined` for anything that is not a side. */
export const sideOf = (value: string | string[] | undefined): TradeSide | undefined =>
  value === 'buy' || value === 'sell' ? value : undefined;

/** The Start Trade link for a side, keeping a counterparty named in advance. */
export function startTradeHref(side: TradeSide, counterparty?: string): string {
  const query = new URLSearchParams({ side });
  if (counterparty !== undefined && counterparty !== '') query.set('with', counterparty);
  return `/trade/new?${query.toString()}`;
}

const CHOICES: readonly { side: TradeSide; title: string; body: string }[] = [
  {
    side: 'buy',
    title: 'I’m buying',
    body: 'You pay into escrow. The seller is paid only once you confirm the item is what you agreed.',
  },
  {
    side: 'sell',
    title: 'I’m selling',
    body: 'The buyer’s money is held before you ship, and released to you when they confirm delivery.',
  },
];

/**
 * The first step of Start Trade (owner rulings 2026-11-20 and 2026-11-22). Every account buys and sells,
 * so the person creating the trade says which side they are on, and the buyer's or the seller's flow
 * opens. `picked` is the side of the Buy/Sell mode they are in: it is marked, and Continue opens it, so
 * one tap confirms it; tapping the other option opens that side instead. Plain links, so the choice
 * works before any script loads and the side survives a reload.
 */
export function SideChoice({
  counterparty,
  picked,
}: {
  counterparty?: string;
  picked?: TradeSide;
}): React.JSX.Element {
  return (
    <ScreenColumn>
      <ScreenHeader title="Start a trade" backHref="/trades" />
      <h2 className="mb-[12px] font-display text-[15px] font-semibold">Are you buying or selling?</h2>
      <ul className="flex flex-col gap-[10px]">
        {CHOICES.map((choice) => {
          const isPicked = choice.side === picked;
          return (
            <li key={choice.side}>
              <a
                href={startTradeHref(choice.side, counterparty)}
                {...(isPicked ? { 'aria-current': 'true' as const } : {})}
                className={cx(
                  'block rounded-md border-[1.5px] border-solid bg-surface-primary p-[14px] hover:border-trust-indigo focus-visible:outline-[2.5px] focus-visible:outline-offset-[2px] focus-visible:outline-trust-indigo',
                  isPicked ? 'border-trust-indigo bg-trust-indigo-soft' : 'border-border-hairline',
                )}
              >
                <span className="flex items-center justify-between gap-[8px] text-[13.5px] font-semibold text-midnight-text">
                  {choice.title}
                  {isPicked && <span className="text-[11px] font-semibold text-trust-indigo">Selected</span>}
                </span>
                <span className="mt-[4px] block text-[12px] leading-[1.5] text-slate">{choice.body}</span>
              </a>
            </li>
          );
        })}
      </ul>
      {picked !== undefined && (
        <div className="mt-[16px]">
          <Button asChild>
            <a href={startTradeHref(picked, counterparty)}>Continue</a>
          </Button>
        </div>
      )}
    </ScreenColumn>
  );
}
