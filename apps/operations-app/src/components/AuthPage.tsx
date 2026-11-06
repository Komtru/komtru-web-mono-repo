import { KomtruLogo } from '@komtru/ui-kit';

/**
 * The page the doors before a session are drawn on: sign-in and the welcome flow. A centred column
 * on the secondary surface with the Ops lockup above it, the same footprint the error and not-found
 * screens use, so the console's entry reads as one family. Owns the page's `<main>`.
 */
export function AuthPage({
  width = 420,
  children,
}: {
  width?: number;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <main className="flex min-h-dvh items-start justify-center bg-surface-secondary px-[16px] py-[48px]">
      <div className="w-full" style={{ maxWidth: width }}>
        <div className="mb-[24px] flex justify-center text-midnight-text">
          <KomtruLogo product="ops" />
        </div>
        {children}
      </div>
    </main>
  );
}
