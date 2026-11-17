'use client';

import { Banner, Button } from '@komtru/ui-kit';
import { useId, useState } from 'react';

/**
 * "Contact TrustOps" and "Contact support instead". The app has no support inbox to open yet, so the button shows the one
 * thing support asks for: the reference that finds the case. It is a disclosure, so a screen reader hears it is one.
 */
export function ContactSupport({
  label,
  reference,
}: {
  label: string;
  reference: string;
}): React.JSX.Element {
  const [shown, setShown] = useState(false);
  const region = useId();
  return (
    <div className="flex flex-col gap-[8px]">
      <Button
        type="button"
        variant="secondary"
        aria-expanded={shown}
        aria-controls={region}
        onClick={() => setShown((value) => !value)}
      >
        {label}
      </Button>
      <div id={region}>
        {shown && (
          <Banner tone="info" title="Quote this reference">
            <span className="font-mono">{reference}</span> — give it to support and they’ll find your case
            straight away.
          </Banner>
        )}
      </div>
    </div>
  );
}
