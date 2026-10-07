import type { Metadata } from 'next';
import { EmptyState, PublicShell } from '@komtru/ui-kit';

/**
 * D8 / I1 — a seller's public Trust Passport, the one page of this app a buyer lands on cold.
 *
 * `middleware` rewrites `passport.komtru.com/<slug>` here, which is what keeps the shared URL free
 * of an app path. No navigation at any width, by the reference's own instruction: "this is a public
 * page a buyer lands on cold, so the layout is content-first like a landing page, not an app shell."
 *
 * T-114 builds what goes inside. This ticket owns the host, the route and the shell.
 */
export const metadata: Metadata = { title: 'Trust Passport' };

export default async function PassportPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.JSX.Element> {
  const { slug } = await params;

  return (
    <PublicShell brandLabel="Komtru">
      <EmptyState
        title="This Trust Passport isn't published yet"
        body={`Nothing is being shown for "${slug}" — a seller's verified history, completed trades and open disputes appear here once their passport is live.`}
      />
    </PublicShell>
  );
}
