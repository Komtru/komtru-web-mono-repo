'use client';

import { useMyMerchantApplication, useTradeStandards } from '@komtru/api-client/react';
import { Button, EmptyState, ScreenColumn, StatusHero } from '@komtru/ui-kit';
import { LoadProblem, Loading } from '../account/states';
import { SHOP_HREF, VERIFICATION_HREF, phaseOf } from './rules';

/**
 * SO5 (T-121): "Your Shop Is Live". Drawn only once operations have approved the application, so the copy can say
 * what the reference's pre-approval copy could not: that the shop is a Verified Merchant. Until then the screen says
 * the shop is not live and sends the person to their status.
 */
export function SellLive(): React.JSX.Element {
  const application = useMyMerchantApplication();
  const standards = useTradeStandards();

  if (application.isPending || standards.isPending) {
    return (
      <ScreenColumn>
        <Loading label="Loading your shop" lines={3} />
      </ScreenColumn>
    );
  }
  if (application.data === undefined || standards.data === undefined) {
    return (
      <ScreenColumn>
        <LoadProblem
          what="your shop"
          onRetry={() => {
            void application.refetch();
            void standards.refetch();
          }}
        />
      </ScreenColumn>
    );
  }

  const app = application.data;
  if (app === null || phaseOf(app) !== 'APPROVED') {
    return (
      <ScreenColumn>
        <EmptyState
          title="Your shop isn’t live yet"
          body="It goes live once a person has checked your business details. You’ll see the decision in your verification."
          action={
            <Button asChild variant="secondary">
              <a href={VERIFICATION_HREF}>See your application’s status</a>
            </Button>
          }
        />
      </ScreenColumn>
    );
  }

  const names = (app.form.categories ?? []).map(
    (code) => standards.data.find((standard) => standard.categoryCode === code)?.categoryName ?? code,
  );
  const plural = names.length === 1 ? 'this category' : 'these categories';
  return (
    <ScreenColumn>
      <StatusHero tone="success" title="Your shop is live">
        {names.join(', ')} · Verified Merchant. Trade Standards for {plural} now apply automatically to
        everything you list.
      </StatusHero>
      <Button asChild>
        <a href={SHOP_HREF}>Go to your shop</a>
      </Button>
    </ScreenColumn>
  );
}
