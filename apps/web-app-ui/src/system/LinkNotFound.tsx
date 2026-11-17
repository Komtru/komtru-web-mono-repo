'use client';

import { useMe } from '@komtru/api-client/react';
import { ActionStack, Button, NoteBanner, ScreenColumn, ScreenHeader, StatusHero } from '@komtru/ui-kit';
import { ContactSupport } from '../account/ContactSupport';

/**
 * SP-M19: a dead link turned into a safety message, because a fake link is the real risk. It is what a Trade Code or
 * link that opens nothing says: the code may be mistyped, or the Trade cancelled or expired. It never says which, and
 * never whether a Trade exists that the person may not see; the platform answers all of those the same way.
 *
 * "Contact support" shows the account's support reference (the inbox, SP-M06, is T-129's), and is not drawn when the
 * reference cannot be read, so there is never a button that opens nothing.
 */
export function LinkNotFound({ backHref = '/trades' }: { backHref?: string }): React.JSX.Element {
  const me = useMe();
  const reference = me.data?.account.supportReference;
  return (
    <ScreenColumn>
      <ScreenHeader title="Trade" as="p" backHref={backHref} backLabel="Back to your Trades" />
      <StatusHero tone="warning" title="We can’t find that Trade">
        The code may be mistyped, or the Trade may have been cancelled or have expired.
      </StatusHero>
      <NoteBanner>
        Komtru never asks you to pay from a link. Search the Trade Code inside the app instead.
      </NoteBanner>
      <p className="mb-[14px] text-[11.5px] leading-[1.6] text-slate">
        If someone invited you to a Trade, sign in with the phone number or email they used.
      </p>
      <ActionStack>
        <Button asChild>
          <a href="/find">Enter a Trade Code</a>
        </Button>
        {reference !== undefined && reference !== null && (
          <ContactSupport label="Contact support" reference={reference} />
        )}
      </ActionStack>
    </ScreenColumn>
  );
}
