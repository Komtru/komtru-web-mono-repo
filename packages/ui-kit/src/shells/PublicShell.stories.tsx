/* eslint-disable komtru-design/no-raw-hex -- `.passport-hero`'s gradient ends on #1A2440, a literal
   the reference declares in the rule itself and T-011 found no `:root` token for. This is story
   scaffolding so D8's visual check has the right thing in the rail; `.passport-hero` itself is
   T-114's component, and tokenising the stop is that ticket's call. */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Avatar } from '../primitives/Avatar.js';
import { PublicShell } from './PublicShell.js';

const PASSPORT_HERO = (
  <div className="mb-[12px] rounded-lg bg-[linear-gradient(150deg,var(--komtru-midnight),#1A2440)] p-[20px] text-pure-white">
    <div className="flex items-start justify-between">
      <Avatar initials="TE" className="h-[44px] w-[44px] bg-pure-white/15 text-[15px] text-pure-white" />
    </div>
    <b className="mt-[10px] block text-[16px]">TechEdge NG</b>
    <div className="mt-[2px] text-[11px] text-pure-white/60">Electronics Specialist · Lagos</div>
    <div className="mt-[16px] grid grid-cols-2 gap-[12px]">
      {[
        ['342', 'Trades'],
        ['98.7%', 'Fulfilment'],
        ['4 yrs', 'Active'],
        ['0', 'Disputes'],
      ].map(([value, label]) => (
        <div key={label}>
          <b className="block font-mono text-[16px]">{value}</b>
          <span className="text-[9px] text-pure-white/55 uppercase">{label}</span>
        </div>
      ))}
    </div>
    <button
      type="button"
      className="mt-[16px] w-full cursor-pointer rounded-sm border-[1px] border-solid border-pure-white/20 bg-pure-white/12 p-[9px] text-[12px] font-semibold text-pure-white"
    >
      Start a Trade
    </button>
  </div>
);

const LISTINGS = [
  ['iPhone 13 Pro, 256GB', '3 in stock', '₦452,000'],
  ['MacBook Air M2', '1 in stock', '₦980,000'],
];

const LISTING_ROWS = (
  <>
    <h4 className="mb-[12px] text-[14px]">Active listings</h4>
    {LISTINGS.map(([title, stock, price]) => (
      <div
        key={title}
        className="mb-[8px] flex items-center gap-[10px] rounded-md border-[1px] border-solid border-border-hairline bg-surface-primary p-[10px]"
      >
        <div className="h-[40px] w-[40px] shrink-0 rounded-[8px] bg-[linear-gradient(135deg,var(--stone-gray),var(--cloud-gray))]" />
        <div>
          <div className="text-[12.5px] font-semibold">{title}</div>
          <div className="mt-[1px] text-[10.5px] text-slate">{stock}</div>
        </div>
        <div className="ml-auto font-mono text-[12.5px] font-semibold">{price}</div>
      </div>
    ))}
  </>
);

const meta = {
  title: 'Shells/PublicShell',
  component: PublicShell,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PublicShell>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Reference screen D8 — no sidebar, no header: the hero in the rail and the stock beside it. */
export const SellerProfile: Story = {
  args: { aside: PASSPORT_HERO, children: LISTING_ROWS },
};

/** Reference screen T5 — the same page with the brand bar, one column at tablet width. */
export const SellerProfileTablet: Story = {
  args: { brandLabel: 'Komtru', aside: PASSPORT_HERO, children: LISTING_ROWS },
};

/** A public page with nothing to put in the rail — the main column takes the full width. */
export const NoAside: Story = {
  args: { brandLabel: 'Komtru', children: LISTING_ROWS },
};
