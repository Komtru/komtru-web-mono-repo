import { Button, KomtruLogo } from '@komtru/ui-kit';
import { ENTRY } from '../flow';
import { EntryFrame } from './EntryFrame';

/** Screen E1 — the first screen, ever. */
export function Welcome(): React.JSX.Element {
  return (
    <EntryFrame
      footer={
        <>
          <Button asChild>
            <a href={ENTRY.signUp}>Create account</a>
          </Button>
          <Button asChild variant="secondary">
            <a href={ENTRY.login}>Log in</a>
          </Button>
        </>
      }
    >
      <div className="px-[20px] pt-[40px] pb-[24px] text-center">
        <div className="mb-[28px] flex items-center justify-center">
          {/* `.welcome-hero .w-logo`: the lockup at 18px with an 8px gap, larger than the app bar's. */}
          <KomtruLogo size={20} style={{ fontSize: '18px', gap: '8px' }} />
        </div>
        <svg viewBox="0 0 300 120" fill="none" aria-hidden className="my-[24px] h-[120px] w-full">
          <g className="stroke-border-hairline" strokeWidth="1.2">
            <line x1="60" x2="150" y1="70" y2="40" />
            <line x1="150" x2="240" y1="40" y2="65" />
          </g>
          <g className="fill-trust-emerald">
            <circle cx="60" cy="70" r="4" />
            <circle cx="150" cy="40" r="5" />
            <circle cx="240" cy="65" r="4" />
          </g>
          <circle
            cx="150"
            cy="40"
            r="13"
            fill="none"
            className="stroke-trust-indigo"
            strokeDasharray="2 3"
            strokeWidth="1.4"
          />
        </svg>
        <h1 className="mb-[10px] text-[22px] leading-[1.3] font-semibold">
          Trade with strangers, protected.
        </h1>
        <p className="mx-auto max-w-[260px] text-[13px] leading-[1.6] text-slate">
          Komtru holds payment safely until both sides deliver on what was agreed — no more sending money and
          hoping.
        </p>
      </div>
    </EntryFrame>
  );
}
