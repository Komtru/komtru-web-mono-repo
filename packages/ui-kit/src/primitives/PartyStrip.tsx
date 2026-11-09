import { Avatar, type AvatarTone } from './Avatar.js';
import { cx } from './cx.js';
import { FOCUS_RING } from './focus.js';

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
