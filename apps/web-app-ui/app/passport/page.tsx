import type { Metadata } from 'next';
import { EmptyState, PublicShell } from '@komtru/ui-kit';

export const metadata: Metadata = { title: 'Trust Passport' };

/**
 * `passport.komtru.com` with no seller in the URL. A Trust Passport is always somebody's, so there
 * is nothing to draw here — say that, rather than inventing a directory the product does not have.
 */
export default function PassportIndexPage(): React.JSX.Element {
  return (
    <PublicShell brandLabel="Komtru">
      <EmptyState
        title="A Trust Passport belongs to a seller"
        body="Open the link the seller shared with you — it carries their name, and the page shows their verified trading history."
      />
    </PublicShell>
  );
}
