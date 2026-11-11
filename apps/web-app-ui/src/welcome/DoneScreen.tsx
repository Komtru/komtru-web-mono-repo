'use client';

import { Button, TextField } from '@komtru/ui-kit';
import { tradeCodeSchema, TRADE_CODE_EXAMPLE } from '@komtru/shared-types';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { WelcomeFrame } from './parts';
import { markWelcomeDone, welcomeName } from './state';

const subscribeNever = (): (() => void) => () => undefined;

/**
 * OB5: the walkthrough is over the moment this shows, so it is marked done here and not on a button: closing the tab
 * on this screen must not bring it back. Two first actions follow: start a protected trade, or open one someone sent.
 * v2 draws no screen for typing a code, so "Enter a Trade Code" opens the field in place and goes to `/trades/<code>`,
 * which already resolves a code to its trade.
 */
export function DoneScreen(): React.JSX.Element {
  const router = useRouter();
  const name = useSyncExternalStore(subscribeNever, welcomeName, () => null);
  const [entering, setEntering] = useState(false);
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    markWelcomeDone();
  }, []);

  const find = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = tradeCodeSchema.safeParse(code);
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    router.push(`/trades/${encodeURIComponent(parsed.data)}`);
  };

  return (
    <WelcomeFrame
      footer={
        entering ? (
          <Button type="submit" form="welcome-code">
            Find trade
          </Button>
        ) : (
          <>
            <Button asChild>
              <a href="/trade/new">Start a Trade</a>
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setEntering(true);
              }}
            >
              Enter a Trade Code
            </Button>
          </>
        )
      }
    >
      <div className="px-[20px] pt-[12px] text-center">
        <div aria-hidden className="mx-auto mb-[16px] h-[56px] w-[56px]">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            className="stroke-trust-emerald"
          >
            <circle cx="12" cy="12" r="10" opacity=".15" />
            <path d="M7 12.5l3.2 3.2L17 9" />
          </svg>
        </div>
        <h2 className="mb-[6px] text-[19px] font-semibold">
          {name === null ? 'You’re all set' : `You’re all set, ${name}`}
        </h2>
        <p className="mb-[16px] text-[12.5px] leading-[1.5] text-slate">
          Start your first protected Trade, or find one a seller already sent you.
        </p>
      </div>
      {entering && (
        <form id="welcome-code" onSubmit={find} noValidate>
          <TextField
            label="Trade Code"
            mono
            autoComplete="off"
            autoCapitalize="characters"
            value={code}
            placeholder={TRADE_CODE_EXAMPLE}
            invalid={invalid}
            helper={
              invalid ? `A Trade Code looks like ${TRADE_CODE_EXAMPLE}. Check it and try again.` : undefined
            }
            onChange={(event) => {
              setCode(event.target.value);
              setInvalid(false);
            }}
          />
        </form>
      )}
    </WelcomeFrame>
  );
}
