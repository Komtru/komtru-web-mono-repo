import type { Metadata } from 'next';
import { UpdateRequired } from '../../../src/system/UpdateRequired';

export const metadata: Metadata = { title: 'Please update Komtru' };

/** SP-M15 (F-044): this version is no longer supported. */
export default function UpdateRequiredPage(): React.JSX.Element {
  return <UpdateRequired />;
}
