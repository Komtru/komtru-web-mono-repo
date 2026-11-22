/**
 * An account section at every width (F-071, F-074; owner direction 2026-11-22: no phone-width column in the middle
 * of a desktop window). A phone keeps one column. From tablet up the section's groups flow into two balanced
 * columns, each group kept whole, so a settings screen reads like the reference's desktop account pages rather
 * than a phone screen floating in the space beside the Account rail.
 *
 * Each top-level child is one item in the flow: pass groups, banners and action rows as siblings, not wrapped in
 * a single element, or the whole screen becomes one unbreakable item.
 */
export function AccountPage({
  header,
  children,
}: {
  header: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-[480px] md:max-w-[760px] lg:max-w-[920px]">
      {header}
      <div className="md:columns-2 md:gap-x-[20px] [&>*]:break-inside-avoid">{children}</div>
    </div>
  );
}
