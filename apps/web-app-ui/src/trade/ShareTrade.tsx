'use client';

import { Button } from '@komtru/ui-kit';
import { useState } from 'react';

/**
 * The sender's way to pass a proposal on: the platform's own link for the trade. It is only the Trade Code
 * in a link, so the copy says what the receiver still has to do. Nothing here delivers anything.
 */
export function ShareTrade({ shareUrl, code }: { shareUrl: string; code: string }): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = () => {
    navigator.clipboard.writeText(shareUrl).then(
      () => {
        setState('copied');
      },
      () => {
        setState('failed');
      },
    );
  };
  return (
    <div className="mb-[16px]">
      <Button type="button" variant="secondary" onClick={copy}>
        {state === 'copied' ? 'Link copied' : 'Copy the link'}
      </Button>
      <p role="status" className="mt-[8px] text-[11.5px] leading-[1.6] text-slate">
        {state === 'failed'
          ? `Couldn't copy it. The link is ${shareUrl}, or give them the code ${code}.`
          : 'They can open it once they have an account under the phone number or email you used. The link or the code on its own lets no one in.'}
      </p>
    </div>
  );
}
