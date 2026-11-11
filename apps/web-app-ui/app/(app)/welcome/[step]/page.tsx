import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DoneScreen } from '../../../../src/welcome/DoneScreen';
import { NotificationsScreen } from '../../../../src/welcome/NotificationsScreen';
import { Walkthrough } from '../../../../src/welcome/Walkthrough';

export const metadata: Metadata = { title: 'Welcome to Komtru' };

/**
 * First-time onboarding (F-013, OB1–OB5), at the reference's URLs: `/welcome/1`, `/2`, `/3`, `/notifications`,
 * `/done`. Behind the session like every screen here, and drawn without the app shell: it comes before the app.
 */
export default async function WelcomeStepPage({
  params,
}: {
  params: Promise<{ step: string }>;
}): Promise<React.JSX.Element> {
  const { step } = await params;
  switch (step) {
    case '1':
    case '2':
    case '3':
      return <Walkthrough step={step} />;
    case 'notifications':
      return <NotificationsScreen />;
    case 'done':
      return <DoneScreen />;
    default:
      notFound();
  }
}
