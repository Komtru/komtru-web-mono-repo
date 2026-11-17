'use client';

import { Button, StatusHero } from '@komtru/ui-kit';
import { useState } from 'react';
import { EntryFrame } from '../entry/components/EntryFrame';
import { clearOfflineCache } from '../shell/ServiceWorker';

/**
 * SP-M15: when this version of the app is no longer supported. It says plainly that money and Trades are unaffected.
 * On the web an update is a reload, so "Update now" empties the saved pages (the old version's own files may be among
 * them) and reloads. Whether the cache could be cleared or not, it reloads: a person must never be stuck here.
 */
export function UpdateRequired(): React.JSX.Element {
  const [why, setWhy] = useState(false);
  const [busy, setBusy] = useState(false);

  const update = async () => {
    setBusy(true);
    try {
      await clearOfflineCache();
    } catch {
      // No worker, or the browser refused: the reload still asks the network for the newest files.
    }
    window.location.reload();
  };

  return (
    <EntryFrame
      footer={
        <>
          <Button type="button" disabled={busy} onClick={() => void update()}>
            {busy ? 'Updating…' : 'Update now'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="mx-auto block text-center"
            aria-expanded={why}
            onClick={() => setWhy((value) => !value)}
          >
            Why am I seeing this?
          </Button>
        </>
      }
    >
      <div className="pt-[24px]">
        <StatusHero tone="info" title="Please update Komtru">
          This version is no longer supported. Your Trades and money are safe, and nothing changes until you
          update.
        </StatusHero>
        {why && (
          <p className="text-[12px] leading-[1.6] text-slate">
            Komtru has changed in a way this version can’t follow, so it stops here rather than risk showing
            you something wrong. Updating loads the newest version.
          </p>
        )}
      </div>
    </EntryFrame>
  );
}
