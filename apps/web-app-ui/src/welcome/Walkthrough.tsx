'use client';

import { Button } from '@komtru/ui-kit';
import { useRouter } from 'next/navigation';
import { Dots, WalkthroughArt, WelcomeFrame } from './parts';
import { AFTER_WELCOME, nextPath, stepFor, type StepKey } from './steps';
import { markWelcomeDone } from './state';
import { useWelcomeGate } from './useWelcomeGate';

const POSITION = { '1': 1, '2': 2, '3': 3 } as const;

/**
 * OB1–OB3: what makes Komtru different, one idea a screen, before anything is asked of the person. Skip is on every
 * one and leaves the walkthrough altogether — the reference says "entirely optional to skip at any point" — so a
 * skipper is not asked for notifications here; the preference screens are where that lives.
 */
export function Walkthrough({ step }: { step: '1' | '2' | '3' }): React.JSX.Element {
  const router = useRouter();
  useWelcomeGate();
  const copy = stepFor(step);
  if (copy === undefined) throw new Error(`no walkthrough step ${step}`);
  const key: StepKey = step;

  const skip = () => {
    markWelcomeDone();
    router.replace(AFTER_WELCOME);
  };
  const next = nextPath(key);

  return (
    <WelcomeFrame
      footerRow
      footer={
        <>
          <Button variant="ghost" className="shrink-0" onClick={skip}>
            Skip
          </Button>
          <Button
            onClick={() => {
              if (next !== undefined) router.push(next);
            }}
          >
            {step === '3' ? 'Get started' : 'Next'}
          </Button>
        </>
      }
    >
      <WalkthroughArt step={step} />
      <div className="px-[12px] text-center">
        <h2 className="mb-[8px] text-[20px] font-semibold">{copy.title}</h2>
        <p className="text-[13px] leading-[1.6] text-slate">{copy.body}</p>
      </div>
      <div className="mt-auto pt-[24px]">
        <Dots at={POSITION[step]} />
      </div>
    </WelcomeFrame>
  );
}
