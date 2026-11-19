'use client';

import { useMyMerchantApplication, useSaveMerchantDraft, useTradeStandards } from '@komtru/api-client/react';
import type { TradeStandard } from '@komtru/api-client';
import { Button, EmptyState, FOCUS_RING, RiskBanner, cx } from '@komtru/ui-kit';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LoadProblem, Loading } from '../account/states';
import { SellFrame } from './Frame';
import { STEP_HREF, categoryComplete, stepBody, valuesFrom, type SellValues } from './rules';

const ELECTRONICS_MARK = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="7" width="16" height="12" rx="2.5" />
    <path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7" />
  </svg>
);

const FASHION_MARK = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 4l3 2 3-2 3 3-2 2v11H8V9L6 7z" />
  </svg>
);

const GENERIC_MARK = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
    <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
  </svg>
);

/** The tile's mark and its tint, by the category's code. A category with no drawing of its own gets the generic box. */
function markFor(code: string): { mark: React.ReactNode; tint: string; stroke: string } {
  if (code === 'electronics') {
    return { mark: ELECTRONICS_MARK, tint: 'bg-trust-indigo-soft', stroke: 'stroke-info-on-soft' };
  }
  if (code === 'fashion') {
    return { mark: FASHION_MARK, tint: 'bg-warning-soft', stroke: 'stroke-warning-on-soft' };
  }
  return { mark: GENERIC_MARK, tint: 'bg-surface-secondary', stroke: 'stroke-slate' };
}

/**
 * SO2 (T-121): "What Do You Sell?". The categories are the trade standards the platform publishes, so the inspection
 * window on each tile is the one a buyer will be promised. More than one can be chosen; at least one is needed.
 */
export function SellCategory(): React.JSX.Element {
  const application = useMyMerchantApplication();
  const standards = useTradeStandards();

  if (application.isPending || standards.isPending) {
    return (
      <SellFrame title="Category" step={2} backHref={STEP_HREF.start} action={null}>
        <Loading label="Loading the categories" lines={3} />
      </SellFrame>
    );
  }
  if (application.data === undefined || standards.data === undefined) {
    return (
      <SellFrame title="Category" step={2} backHref={STEP_HREF.start} action={null}>
        <LoadProblem
          what="the categories"
          onRetry={() => {
            void application.refetch();
            void standards.refetch();
          }}
        />
      </SellFrame>
    );
  }
  if (standards.data.length === 0) {
    return (
      <SellFrame title="Category" step={2} backHref={STEP_HREF.start} action={null}>
        <EmptyState
          title="No categories are open to sell yet"
          body="Komtru opens categories as their trade standards are published. Check back soon."
        />
      </SellFrame>
    );
  }
  return <SellPicker initial={valuesFrom(application.data)} standards={standards.data} />;
}

function SellPicker({
  initial,
  standards,
}: {
  initial: SellValues;
  standards: TradeStandard[];
}): React.JSX.Element {
  const router = useRouter();
  const save = useSaveMerchantDraft();
  const [values, setValues] = useState<SellValues>(initial);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const ready = categoryComplete(values) && !save.isPending;

  const toggle = (code: string) =>
    setValues((current) => ({
      ...current,
      categories: current.categories.includes(code)
        ? current.categories.filter((item) => item !== code)
        : [...current.categories, code],
    }));

  const next = () => {
    if (!ready) return;
    setProblem(undefined);
    save.mutate(stepBody('category', values), {
      onSuccess: () => router.push(STEP_HREF['verify-business']),
      onError: () => setProblem('Couldn’t save your categories. Check your connection and try again.'),
    });
  };

  return (
    <SellFrame
      title="Category"
      step={2}
      backHref={STEP_HREF.start}
      action={
        <>
          {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
          <Button type="button" disabled={!ready} onClick={next}>
            {save.isPending ? 'Saving…' : 'Continue to verification'}
          </Button>
        </>
      }
    >
      <p className="mb-[16px] text-[12px] leading-[1.6] text-slate">
        This decides the inspection window and refund terms buyers see on your listings — Electronics runs 48
        hours, Fashion &amp; Luxury runs 24.
      </p>
      <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2">
        {standards.map((standard) => {
          const pressed = values.categories.includes(standard.categoryCode);
          const { mark, tint, stroke } = markFor(standard.categoryCode);
          return (
            <button
              key={standard.categoryCode}
              type="button"
              aria-pressed={pressed}
              onClick={() => toggle(standard.categoryCode)}
              className={cx(
                FOCUS_RING,
                'flex w-full cursor-pointer flex-col overflow-hidden rounded-md bg-surface-primary p-0 text-left',
                'border-[1.5px] border-solid',
                pressed ? 'border-trust-indigo' : 'border-border-hairline',
              )}
            >
              <span className={cx('flex h-[72px] items-center justify-center', tint)}>
                <span className={cx('h-[28px] w-[28px]', stroke)} aria-hidden>
                  {mark}
                </span>
              </span>
              <span className="flex flex-col gap-[2px] px-[14px] py-[12px]">
                <b className="text-[13px]">{standard.categoryName}</b>
                <span className="text-[11.5px] text-slate">
                  {standard.inspectionWindowHours}h inspection standard
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </SellFrame>
  );
}
