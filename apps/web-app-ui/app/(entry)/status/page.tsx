import type { Metadata } from 'next';
import { ServiceNotice } from '../../../src/system/ServiceNotice';

export const metadata: Metadata = { title: 'Service notice' };

/** SP-M14 (F-044): whether Komtru is working, for anyone, signed in or not. */
export default function StatusPage(): React.JSX.Element {
  return <ServiceNotice />;
}
