import type { Metadata } from 'next';
import { AppShell } from '../../../../src/shell/AppShell';
import { resolveViewer } from '../../../../src/shell/viewer';
import { TradeByCode } from '../../../../src/trade/TradeByCode';

/** The path segment as typed. A malformed escape is left as it is, and fails as "not a Trade Code". */
const typedCode = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

export const metadata: Metadata = { title: 'Trade Code' };

/**
 * `/trades/<code>`: the link a sender shares and where the Trade Code bar lands. The code is read
 * here as typed and normalised in the screen, so a lowercase or `-NG`-less code still opens.
 */
export default async function TradeByCodePage({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<React.JSX.Element> {
  const { code } = await params;
  const viewer = await resolveViewer();

  return (
    <AppShell tab="trades" viewer={viewer}>
      <TradeByCode typed={typedCode(code)} />
    </AppShell>
  );
}
