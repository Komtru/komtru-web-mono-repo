'use client';

import { type TradeStandard } from '@komtru/api-client';
import { useTradeStandards } from '@komtru/api-client/react';
import { ScreenHeader, StandardCard, TermList, TermRow } from '@komtru/ui-kit';
import { hoursLabel } from './format';
import { Column, LoadFailed, LoadingScreen, NoteBanner, RULES } from './parts';

const BRIEFCASE = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <rect x="4" y="7" width="16" height="12" rx="2.5" />
    <path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7" />
  </svg>
);

const GARMENT = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M9 4l3 2 3-2 3 3-2 2v11H8V9L6 7z" />
  </svg>
);

/** The two launch categories carry their own mark, as CTS1 draws them; a later category gets the neutral one. */
const CATEGORY_MARK: Record<string, { icon: React.ReactNode; tone: 'info' | 'warning' }> = {
  fashion: { icon: GARMENT, tone: 'warning' },
};
const DEFAULT_MARK = { icon: BRIEFCASE, tone: 'info' as const };

const proofLine = (standard: TradeStandard): string => {
  const { minPhotos, requireVideo } = standard.proofMedia;
  const photos = minPhotos === 0 ? undefined : `${String(minPhotos)} photo${minPhotos === 1 ? '' : 's'}`;
  const video = requireVideo ? 'a video' : undefined;
  return [photos, video].filter((part) => part !== undefined).join(' and ') || 'None required';
};

/**
 * CTS1. What the platform applies to every trade in a category, read from the Trade Standards the
 * backend serves, so the screen cannot say something the platform does not do.
 *
 * Only what the standard actually carries is drawn: the reference also lists when the inspection clock
 * starts, how far a buyer may extend it, and the refund and cancellation terms, none of which the API
 * returns today. Writing them from the drawing would be promising terms nothing enforces.
 */
export function TradeStandards({ backHref = '/trades' }: { backHref?: string }): React.JSX.Element {
  const standards = useTradeStandards();

  return (
    <Column>
      <ScreenHeader title="Trade Standards" backHref={backHref} />
      <NoteBanner icon={RULES}>
        These apply automatically to every trade in the category. Nobody sets them per trade, which is what
        keeps the protection consistent.
      </NoteBanner>
      {standards.isPending && <LoadingScreen label="Loading Trade Standards" />}
      {standards.isError && (
        <LoadFailed
          title="Couldn't load the Trade Standards"
          body="Check your connection and try again."
          onRetry={() => void standards.refetch()}
        />
      )}
      {standards.data?.map((standard) => (
        <StandardCard
          key={standard.versionId}
          title={standard.categoryName}
          icon={(CATEGORY_MARK[standard.categoryCode] ?? DEFAULT_MARK).icon}
          tone={(CATEGORY_MARK[standard.categoryCode] ?? DEFAULT_MARK).tone}
        >
          <TermList aria-label={`${standard.categoryName} terms`}>
            <TermRow label="Inspection window">{hoursLabel(standard.inspectionWindowHours)}</TermRow>
            <TermRow label="Item details">
              {standard.itemSpecFields.map((field) => field.label).join(', ')}
            </TermRow>
            <TermRow label="Seller proof">{proofLine(standard)}</TermRow>
            <TermRow label="Delivery deadline">
              {String(standard.deliveryDeadlineDays)} day{standard.deliveryDeadlineDays === 1 ? '' : 's'}
            </TermRow>
          </TermList>
        </StandardCard>
      ))}
    </Column>
  );
}
