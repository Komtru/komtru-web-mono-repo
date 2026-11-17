import { cx } from '@komtru/ui-kit';

type Mark = 'camera' | 'download' | 'warning' | 'alert';

const MARKS: Record<Mark, { stroke: string; paths: React.ReactNode }> = {
  camera: {
    stroke: 'stroke-slate',
    paths: (
      <>
        <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
        <circle cx="12" cy="13" r="3.5" />
      </>
    ),
  },
  download: { stroke: 'stroke-midnight-text', paths: <path d="M12 4v11M7 11l5 5 5-5M5 20h14" /> },
  warning: {
    stroke: 'stroke-warning-on-soft',
    paths: (
      <>
        <path d="M12 4l9 16H3z" />
        <path d="M12 10v4M12 17h.01" />
      </>
    ),
  },
  alert: {
    stroke: 'stroke-risk-on-soft',
    paths: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16h.01" />
      </>
    ),
  },
};

/**
 * `.m-success` as the system screens draw it: a neutral ring holding one line icon, a heading and a short paragraph,
 * centred. ui-kit's `StatusHero` draws a status ring (a tick, a clock, a bang) for "it happened" and "it is held";
 * these screens are not statuses, and a clock over "Allow the camera" says the wrong thing, so the icon is chosen here.
 */
export function SystemHero({
  mark,
  title,
  as: Heading = 'h1',
  children,
  className,
}: {
  mark: Mark;
  title: string;
  as?: 'h1' | 'h2';
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  const { stroke, paths } = MARKS[mark];
  return (
    <div className={cx('px-[20px] pt-[24px] pb-[20px] text-center', className)}>
      <div className="mx-auto mb-[16px] flex h-[60px] w-[60px] items-center justify-center rounded-full border border-solid border-border-hairline bg-surface-secondary">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cx('h-[26px] w-[26px]', stroke)}
        >
          {paths}
        </svg>
      </div>
      <Heading className="mb-[6px] text-[19px] font-semibold">{title}</Heading>
      <p className="m-0 text-[12.5px] leading-[1.55] text-slate">{children}</p>
    </div>
  );
}
