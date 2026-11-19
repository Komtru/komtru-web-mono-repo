import type { Metadata } from 'next';
import { ComingSoon } from '../../src/chrome/ComingSoon';

export const metadata: Metadata = {
  title: 'Safer social commerce, built on evidence.',
  description: 'How Komtru reduces the risk in social commerce, and how disputes are decided on evidence.',
};

export default function Page(): React.JSX.Element {
  return (
    <ComingSoon
      title="Safer social commerce, built on evidence."
      summary="Agreements, protected payments and human review. We reduce risk; we do not promise fraud can never happen."
    />
  );
}
