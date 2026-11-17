'use client';

import { Banner, Button, StatusHero } from '@komtru/ui-kit';
import { useState } from 'react';
import { codeRows } from './words';

const WARN_MARK = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16h.01" />
  </svg>
);

/**
 * TF2: the codes, once. They are held by the screen that asked for them and nowhere else — not the query cache, not
 * storage — so closing it ends them; the platform keeps only hashes and cannot show them again. `title` differs
 * between a first setup and a replacement sheet; the rest is the reference's.
 */
export function BackupCodes({
  codes,
  title = 'Two-factor enabled',
  onDone,
}: {
  codes: readonly string[];
  title?: string;
  onDone: () => void;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');

  return (
    <section aria-label="Your backup codes">
      <StatusHero tone="success" title={title}>
        Save these codes somewhere safe — each works once if you ever lose access to your authenticator app.
      </StatusHero>
      <ul className="mb-[16px] grid list-none grid-cols-2 gap-x-[8px] rounded-md border border-solid border-border-hairline bg-surface-primary p-[14px] font-mono text-[13px] leading-[2.2]">
        {codeRows(codes)
          .flat()
          .map((code) => (
            <li key={code} className="text-center">
              {code}
            </li>
          ))}
      </ul>
      <Banner tone="warning" icon={WARN_MARK} title="Shown once">
        Komtru can’t retrieve these again if you lose them — you’d need to reset 2FA entirely instead.
      </Banner>
      <div className="mt-[16px] flex flex-col gap-[8px]">
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy the codes'}
        </Button>
        <Button type="button" onClick={onDone}>
          I’ve saved these codes
        </Button>
      </div>
    </section>
  );
}
