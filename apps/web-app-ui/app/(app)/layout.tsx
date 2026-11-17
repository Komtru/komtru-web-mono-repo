import { ServiceWorker } from '../../src/shell/ServiceWorker';
import { SystemWatcher } from '../../src/system/SystemWatcher';

/**
 * Everything behind a session, and the offline support that goes with it.
 *
 * The service worker is mounted here rather than in the root layout so that it is never installed
 * by someone reading a public Trust Passport. A worker is origin-wide and outlives the page that
 * registered it: a stranger who followed a shared link has not asked this product to keep anything
 * on their device, and `/offline` — the document the worker falls back to — is a screen of *this*
 * app, not of `passport.komtru.com`.
 */
export default function AppLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <>
      <SystemWatcher />
      {children}
      <ServiceWorker />
    </>
  );
}
