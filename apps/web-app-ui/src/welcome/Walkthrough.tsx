'use client';

import { Button } from '@komtru/ui-kit';
import { useRouter } from 'next/navigation';
import { Dots, Overview, WalkthroughArt, WelcomeFrame } from './parts';
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
  const ready = useWelcomeGate();
  const copy = stepFor(step);
  if (copy === undefined) throw new Error(`no walkthrough step ${step}`);
  const key: StepKey = step;

  if (!ready) return <></>;

  const skip = () => {
    markWelcomeDone();
    router.replace(AFTER_WELCOME);
  };
  const next = nextPath(key);

  return (
    <WelcomeFrame
      wide
      footerRow
      footer={
        <>
          <Button variant="ghost" className="shrink-0" onClick={skip}>
            Skip
          </Button>
          <Button
            className="md:w-auto md:min-w-[200px]"
            onClick={() => {
              if (next !== undefined) router.push(next);
            }}
          >
            {step === '3' ? 'Get started' : 'Next'}
          </Button>
        </>
      }
    >
      {/* The wrapper is always here and the overview is its first child or nothing, so the step never remounts. */}
      <div className="flex flex-1 flex-col lg:flex-row lg:items-center">
        <Overview at={key} />
        <div className="flex flex-1 flex-col">
          <WalkthroughArt step={step} />
          <div className="px-[12px] text-center">
            <h2 className="mb-[10px] text-[20px] font-semibold leading-[1.3] md:text-[24px] lg:text-[26px]">
              {copy.title}
            </h2>
            <p className="mx-auto max-w-[260px] text-[13px] leading-[1.6] text-slate md:max-w-[420px] md:text-[15px]">
              {copy.body}
            </p>
          </div>
          <div className="mt-auto pb-[90px] pt-[24px] md:pb-0 md:pt-[32px]">
            <Dots at={POSITION[step]} />
          </div>
        </div>
      </div>
    </WelcomeFrame>
  );
}
