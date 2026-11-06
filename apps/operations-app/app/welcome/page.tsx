import type { Metadata } from 'next';
import { AuthPage } from '../../src/components/AuthPage';
import { WelcomeFlow } from '../../src/components/WelcomeFlow';

export const metadata: Metadata = { title: 'Welcome' };

/** The invitation token is in the URL fragment, which only the browser sees; the flow reads it there. */
export default function WelcomePage(): React.JSX.Element {
  return (
    <AuthPage width={920}>
      <WelcomeFlow />
    </AuthPage>
  );
}
