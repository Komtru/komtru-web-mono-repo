import type { Metadata } from 'next';
import { AppShell } from '../../../../src/shell/AppShell';
import { resolveMode, resolveViewer } from '../../../../src/shell/viewer';
import { SellVerification } from '../../../../src/sell/Verification';

export const metadata: Metadata = { title: 'Verification' };

/** M2 and BVR1 (T-121): the seller's business verification, and the rejection that replaces it. */
export default async function ShopVerificationPage(): Promise<React.JSX.Element> {
  const viewer = await resolveViewer();
  const mode = await resolveMode(viewer);

  return (
    <AppShell tab="account" viewer={viewer} mode={mode}>
      <SellVerification />
    </AppShell>
  );
}
