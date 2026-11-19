import type { Metadata } from 'next';
import { ComingSoon } from '../../src/chrome/ComingSoon';

export const metadata: Metadata = {
  title: 'Terms and privacy policy.',
  description: 'Komtru terms of service and privacy policy.',
};

export default function Page(): React.JSX.Element {
  return (
    <ComingSoon
      title="Terms and privacy policy."
      summary="Our full terms and privacy policy will be published here before Komtru opens."
    />
  );
}
