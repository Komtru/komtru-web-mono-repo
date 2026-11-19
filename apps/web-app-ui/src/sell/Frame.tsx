'use client';

import { ScreenColumn, ScreenHeader, StickyFooter } from '@komtru/ui-kit';

/**
 * The frame the four application steps share (SO1–SO4): the back control, the title, "n / 5" under it, and the
 * sticky action at the foot. Drawn without the app shell, as the reference draws the flow: it is a task, not a
 * place in the app.
 */
export function SellFrame({
  title,
  step,
  backHref,
  action,
  children,
}: {
  title: string;
  step: number;
  backHref: string;
  action: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <ScreenColumn>
      <ScreenHeader title={title} backHref={backHref} backLabel="Back" />
      <p className="mb-[16px] text-center text-[11px] text-slate">{step} / 5</p>
      {children}
      <StickyFooter>{action}</StickyFooter>
    </ScreenColumn>
  );
}
