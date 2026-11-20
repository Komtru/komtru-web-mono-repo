import { ScreenColumn, ScreenHeader } from '@komtru/ui-kit';

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
 * The first step of Start Trade (owner ruling 2026-11-20). Every account buys and sells, so there is
 * no Buy/Sell mode to read the side from: the person creating the trade says which side they are on,
 * and the buyer's or the seller's flow opens. Plain links, so the choice works before any script loads
 * and the side survives a reload.
 */
export function SideChoice({ counterparty }: { counterparty?: string }): React.JSX.Element {
  return (
    <ScreenColumn>
      <ScreenHeader title="Start a trade" backHref="/trades" />
      <h2 className="mb-[12px] font-display text-[15px] font-semibold">Are you buying or selling?</h2>
      <ul className="flex flex-col gap-[10px]">
        {CHOICES.map((choice) => (
          <li key={choice.side}>
            <a
              href={startTradeHref(choice.side, counterparty)}
              className="block rounded-md border-[1.5px] border-solid border-border-hairline bg-surface-primary p-[14px] hover:border-trust-indigo focus-visible:outline-[2.5px] focus-visible:outline-offset-[2px] focus-visible:outline-trust-indigo"
            >
              <span className="block text-[13.5px] font-semibold text-midnight-text">{choice.title}</span>
              <span className="mt-[4px] block text-[12px] leading-[1.5] text-slate">{choice.body}</span>
            </a>
          </li>
        ))}
      </ul>
    </ScreenColumn>
  );
}
