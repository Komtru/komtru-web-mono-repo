import type { Metadata } from 'next';
import { ComingSoon } from '../../src/chrome/ComingSoon';

export const metadata: Metadata = {
  title: 'Collect where you already travel.',
  description:
    'Komtru park hubs in Lagos, Abuja, Port Harcourt and Jos: how a sealed parcel is handed over and collected.',
};

export default function Page(): React.JSX.Element {
  return (
    <ComingSoon
      title="Collect where you already travel."
      summary="Motor-park hubs coordinate handover, tracking and collection for orders that do not go to your door."
    />
  );
}
