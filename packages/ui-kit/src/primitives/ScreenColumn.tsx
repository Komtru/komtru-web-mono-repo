/**
 * The column a flow screen sits in. The reference draws these flows on mobile web only, so a wider
 * window gets the same column, centred, rather than a desktop layout nobody drew.
 */
export function ScreenColumn({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="mx-auto w-full max-w-[480px]">{children}</div>;
}
