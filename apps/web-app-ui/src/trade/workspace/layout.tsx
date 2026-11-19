// What the tablet and desktop drawings of the deliver-and-inspect screens share (F-069, F-073).

/**
 * The column a trade screen sits in: the phone's 480px, a 760px column on a tablet, and the whole content area on a
 * desktop, where the screen lays out its own columns. The same widths as `ProposeWorkspace`.
 */
export function TradeColumn({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="mx-auto w-full max-w-[480px] md:max-w-[760px] lg:max-w-none">{children}</div>;
}

/**
 * The reference's `.dweb-panel`: a hairline card with a small heading, used for each block of a wide screen. It is a
 * plain group, not a landmark: a screen of five panels would be five regions, and the heading already names it.
 * Anything with its own heading inside draws it one level down (`as="h3"`).
 */
export function Panel({
  title,
  action,
  children,
  id,
  className = '',
}: {
  title: string;
  /** Something at the heading's right edge, such as "View all". */
  action?: React.ReactNode;
  children: React.ReactNode;
  /** Lets a control that shows this panel name it (`aria-controls`). */
  id?: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      {...(id === undefined ? {} : { id })}
      className={`min-w-0 rounded-md border border-solid border-border-hairline bg-surface-primary p-[16px] ${className}`}
    >
      <div className="mb-[10px] flex items-baseline justify-between gap-[8px]">
        <h2 className="m-0 text-[13px] font-semibold text-midnight-text">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}
