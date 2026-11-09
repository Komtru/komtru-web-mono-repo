import { Avatar, type AvatarTone } from './Avatar.js';
import { cx } from './cx.js';
import { FOCUS_RING } from './focus.js';

export interface ItemCardProps {
  title: string;
  /** "Sierra Blue · Sealed box": the condition line under the title. */
  sub?: string;
  /** Already formatted, in naira. This component never formats or adds money. */
  price: string;
  /** The item's photo. The reference draws a gradient block until there is one. */
  imageUrl?: string;
  className?: string;
}

/**
 * `.item-card` — the thing being traded: a 64px thumb, the title, one line of condition and the
 * price. Used by the start screen, the request the seller answers and the agreement summary, so the
 * item reads the same wherever it appears.
 */
export function ItemCard({ title, sub, price, imageUrl, className }: ItemCardProps): React.JSX.Element {
  return (
    <div
      className={cx(
        'mb-[16px] flex gap-[12px] rounded-md border border-solid border-border-hairline bg-surface-primary p-[12px]',
        className,
      )}
    >
      {imageUrl === undefined ? (
        <div
          aria-hidden
          className="h-[64px] w-[64px] shrink-0 rounded-[10px] bg-[linear-gradient(135deg,var(--stone-gray),var(--cloud-gray))]"
        />
      ) : (
        // A seller's own photo, from a signed URL: this package has no next/image to hand it to.
        <img src={imageUrl} alt="" className="h-[64px] w-[64px] shrink-0 rounded-[10px] object-cover" />
      )}
      <div className="min-w-0">
        <div className="text-[14px] font-semibold">{title}</div>
        {sub !== undefined && <div className="mt-[2px] text-[11px] text-slate">{sub}</div>}
        <div className="mt-[6px] font-mono text-[16px] font-semibold">{price}</div>
      </div>
    </div>
  );
}

export interface PartyStripProps {
  name: string;
  initials: string;
  tone?: AvatarTone;
  /** "342 trades · 98.7% fulfilment". Only what the platform actually told us. */
  meta?: string;
  /** Makes the strip a link, with the reference's trailing arrow. */
  href?: string;
  className?: string;
}

const ARROW = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

/** `.seller-strip` — who is on the other side: avatar, name, a line of record, between two hairlines. */
export function PartyStrip({
  name,
  initials,
  tone,
  meta,
  href,
  className,
}: PartyStripProps): React.JSX.Element {
  const Tag = href === undefined ? 'div' : 'a';
  return (
    <Tag
      {...(href === undefined ? {} : { href })}
      className={cx(
        'mb-[16px] flex items-center gap-[10px] border-y border-solid border-border-hairline py-[10px]',
        href !== undefined && FOCUS_RING,
        className,
      )}
    >
      <Avatar initials={initials} {...(tone === undefined ? {} : { tone })} />
      <div className="min-w-0">
        <b className="block text-[13px]">{name}</b>
        {meta !== undefined && <span className="text-[11px] text-slate">{meta}</span>}
      </div>
      {href !== undefined && <span className="ml-auto h-[16px] w-[16px] stroke-trust-gray">{ARROW}</span>}
    </Tag>
  );
}
