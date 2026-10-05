import { cx } from './cx.js';

export interface NodeLoaderProps {
  /** TXP Principle Six: no bare spinners — every delay names what is happening. Hence required. */
  title: string;
  /** Roughly how long, in the reference's own voice: "Usually under 30 seconds." */
  body?: string;
  className?: string;
}

const DOT = 'h-[9px] w-[9px] rounded-[50%] bg-trust-emerald opacity-[.25] motion-reduce:animate-none';
const PULSE = 'animate-[nodePulse_1.4s_ease-in-out_infinite]';

/**
 * `.node-loader` — three emerald nodes breathing at 1.4s, offset by .18s, over a caption that says
 * what is being waited on. The three nodes are the brand mark's own, mid-handshake.
 */
export function NodeLoader({ title, body, className }: NodeLoaderProps): React.JSX.Element {
  return (
    <div role="status" className={className}>
      <div aria-hidden className="mb-[8px] flex h-[44px] items-center justify-center gap-[6px]">
        <span className={cx(DOT, PULSE)} />
        <span className={cx(DOT, PULSE, '[animation-delay:.18s]')} />
        <span className={cx(DOT, PULSE, '[animation-delay:.36s]')} />
      </div>
      <div className="mt-[4px] text-center">
        <b className="mb-[4px] block text-[13.5px]">{title}</b>
        {body !== undefined && <span className="text-[11.5px] leading-[1.5] text-slate">{body}</span>}
      </div>
    </div>
  );
}
