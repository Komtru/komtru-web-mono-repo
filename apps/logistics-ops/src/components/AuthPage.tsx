import { KomtruLogo } from '@komtru/ui-kit';

/**
 * The page sign-in is drawn on: a centred column on the secondary surface with the Komtru lockup and
 * the portal's name above it, the footprint the error and not-found screens use. Owns the `<main>`.
 */
export function AuthPage({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <main className="flex min-h-dvh items-start justify-center bg-surface-secondary px-[16px] py-[48px]">
      <div className="w-full max-w-[420px]">
        <div className="mb-[24px] flex flex-col items-center gap-[6px] text-midnight-text">
          <KomtruLogo />
          <span className="text-[11px] font-bold uppercase tracking-[.04em] text-slate">
            Logistics portal
          </span>
        </div>
        {children}
      </div>
    </main>
  );
}
