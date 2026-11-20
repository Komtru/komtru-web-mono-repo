'use client';

import { useMyMerchantApplication, useTradeStandards } from '@komtru/api-client/react';
import { Button, EmptyState, ScreenColumn, StatusHero } from '@komtru/ui-kit';
import { LoadProblem, Loading } from '../account/states';
import { START_SELLING_HREF, VERIFICATION_HREF, phaseOf } from './rules';

/**
 * SO5 (T-121): the approved outcome of merchant verification. Nothing goes live: the account gains merchant status, and
 * the screen says so. Drawn only once operations have approved the application; until then it says the business is not
 * a merchant yet and points to the verification tab, where the status is.
 */
export function SellLive(): React.JSX.Element {
  const application = useMyMerchantApplication();
  const standards = useTradeStandards();

  if (application.isPending || standards.isPending) {
    return (
      <ScreenColumn>
        <Loading label="Loading your merchant status" lines={3} />
      </ScreenColumn>
    );
  }
  if (application.data === undefined || standards.data === undefined) {
    return (
      <ScreenColumn>
        <LoadProblem
          what="your merchant status"
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
          title="You’re not a merchant yet"
          body="Merchant status is given once a person has checked your business details. You’ll see the decision on your verification tab."
          action={
            <Button asChild variant="secondary">
              <a href={VERIFICATION_HREF}>See your verification</a>
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
      <StatusHero tone="success" title="You’re a verified merchant">
        {names.join(', ')} · Verified Merchant. Trade Standards for {plural} apply automatically to everything
        you list, and buyers see the badge on your Trust Passport.
      </StatusHero>
      <Button asChild>
        <a href={START_SELLING_HREF}>Start selling</a>
      </Button>
    </ScreenColumn>
  );
}
