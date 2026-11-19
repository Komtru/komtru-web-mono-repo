import type { Metadata } from 'next';
import { ComingSoon } from '../../src/chrome/ComingSoon';

export const metadata: Metadata = {
  title: 'Komtru is trust infrastructure for social commerce.',
  description: 'About Komtru: trust infrastructure for people who buy and sell on social media in Nigeria.',
};

export default function Page(): React.JSX.Element {
  return (
    <ComingSoon
      title="Komtru is trust infrastructure for social commerce."
      summary="Every trade creates a record. Every meaningful action creates evidence."
    />
  );
}
