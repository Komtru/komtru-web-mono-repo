'use client';

import { Button, TextField } from '@komtru/ui-kit';
import { tradeCodeSchema, TRADE_CODE_EXAMPLE } from '@komtru/shared-types';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { WelcomeFrame } from './parts';
import { forgetWelcomeName, markWelcomeDone, welcomeName } from './state';
import { useWelcomeGate } from './useWelcomeGate';

/**
 * OB5: the walkthrough is over the moment this shows, so it is marked done here and not on a button: closing the tab
 * on this screen must not bring it back. It is only for someone who came through OB4 in this tab: a deep link goes to
 * the app. The first name typed at sign-up is read once, then forgotten. Two first actions follow: start a protected trade, or open one someone sent.
 * v2 draws no screen for typing a code, so "Enter a Trade Code" opens the field in place and goes to `/trades/<code>`,
 * which already resolves a code to its trade.
 */
export function DoneScreen(): React.JSX.Element {
  const ready = useWelcomeGate('done');
  return ready ? <DoneContent /> : <></>;
}

function DoneContent(): React.JSX.Element {
  const router = useRouter();
  // Read once, when the screen first draws on the client, and dropped from storage as soon as it is on screen.
  const [name] = useState(welcomeName);
  const form = useRef<HTMLFormElement>(null);
  const [entering, setEntering] = useState(false);
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    markWelcomeDone();
    forgetWelcomeName();
  }, []);

  // The button that opened the field is gone; keep the keyboard where the person is.
  useEffect(() => {
    if (entering) form.current?.querySelector('input')?.focus();
  }, [entering]);

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
      flush
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
      <div className="px-[20px] pt-[12px] text-center md:pt-0">
        <div aria-hidden className="mx-auto mb-[16px] h-[56px] w-[56px] md:h-[64px] md:w-[64px]">
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
        <h2 className="mb-[6px] text-[19px] font-semibold md:text-[24px]">
          {name === null ? "You're all set" : `You're all set, ${name}`}
        </h2>
        <p className="mx-auto mb-[16px] text-[12.5px] leading-[1.5] text-slate md:max-w-[440px] md:text-[14.5px]">
          Start your first protected Trade, or find one a seller already sent you.
        </p>
      </div>
      {entering && (
        <form id="welcome-code" ref={form} onSubmit={find} noValidate>
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
