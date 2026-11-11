'use client';

import { useRegisterDevice } from '@komtru/api-client/react';
import { Button, NoteBanner } from '@komtru/ui-kit';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { defaultTokenSource, enablePush, notificationSupport, type PushTokenSource } from './push';
import { WelcomeFrame } from './parts';
import { markWelcomeArrived } from './state';
import { stepFor } from './steps';
import { useWelcomeGate } from './useWelcomeGate';

const DONE = '/welcome/done';
const CONTINUE_ID = 'welcome-continue';

const subscribeNever = (): (() => void) => () => undefined;
const askable = (): 'default' => 'default';

type Blocked = 'denied' | 'unsupported';

const BLOCKED_COPY: Record<Blocked, string> = {
  denied:
    "Notifications are blocked in your browser, so we can't switch them on from here. You can allow them in your browser's site settings, and choose how you're told about each thing later in Settings.",
  unsupported:
    "This browser doesn't support notifications. You can still follow every trade in Komtru, and choose how you're told about each thing later in Settings.",
};

/**
 * OB4, asked last, once the value is already clear. "Allow notifications" asks the browser; a grant also registers
 * this device with the platform so push can reach it (T-045's recipient list). Nothing here can block the way on:
 * "Not now", a refusal, a browser with no notifications and a failed registration all end at OB5.
 */
export function NotificationsScreen({
  tokenSource = defaultTokenSource,
}: {
  tokenSource?: PushTokenSource | undefined;
}): React.JSX.Element {
  const router = useRouter();
  const ready = useWelcomeGate();
  const register = useRegisterDevice();
  const copy = stepFor('notifications');
  const [refused, setRefused] = useState<Blocked | undefined>(undefined);
  const [asking, setAsking] = useState(false);

  // What the browser allows is not known on the server, so the server's answer is "askable" and the client corrects it.
  const support = useSyncExternalStore(subscribeNever, notificationSupport, askable);
  const blocked: Blocked | undefined =
    refused ?? (support === 'denied' || support === 'unsupported' ? support : undefined);

  // "Allow" is gone once refused; Continue takes its place and the focus with it.
  useEffect(() => {
    if (refused !== undefined) document.getElementById(CONTINUE_ID)?.focus();
  }, [refused]);

  if (!ready) return <></>;

  const goOn = () => {
    markWelcomeArrived();
    router.push(DONE);
  };

  const allow = async () => {
    setAsking(true);
    const outcome = await enablePush({ register: (body) => register.mutateAsync(body), tokenSource });
    setAsking(false);
    if (outcome === 'denied' || outcome === 'unsupported') {
      setRefused(outcome);
      return;
    }
    goOn();
  };

  return (
    <WelcomeFrame
      flush
      footer={
        blocked === undefined ? (
          <>
            <Button disabled={asking} onClick={() => void allow()}>
              Allow notifications
            </Button>
            <Button variant="secondary" disabled={asking} onClick={goOn}>
              Not now
            </Button>
          </>
        ) : (
          <Button id={CONTINUE_ID} onClick={goOn}>
            Continue
          </Button>
        )
      }
    >
      <div className="text-center">
        <div
          aria-hidden
          className="mx-auto mb-[20px] mt-[32px] flex h-[64px] w-[64px] items-center justify-center rounded-[50%] bg-trust-indigo-soft"
        >
          <svg
            viewBox="0 0 24 24"
            width="28"
            height="28"
            fill="none"
            strokeWidth="1.8"
            strokeLinecap="round"
            className="stroke-trust-indigo"
          >
            <path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10z" />
            <path d="M10 18.5a2 2 0 0 0 4 0" />
          </svg>
        </div>
        <h2 className="mb-[8px] text-[18px] font-semibold">{copy?.title}</h2>
        <p className="mx-auto mb-[20px] max-w-[260px] text-[12.5px] leading-[1.6] text-slate">{copy?.body}</p>
        {/* Mounted before it has anything to say, so a screen reader hears it when it fills. */}
        <div className="text-left" role="status">
          {blocked !== undefined && <NoteBanner>{BLOCKED_COPY[blocked]}</NoteBanner>}
        </div>
      </div>
    </WelcomeFrame>
  );
}
