export interface CounterDiffRowProps {
  label: string;
  /** What the other party proposed, struck through. */
  before: string;
  /** What this counter says instead. */
  after: string;
  beforeCaption?: string;
  afterCaption?: string;
}

/** `.counter-diff-row` — a term that changed: the old value struck through above the new one. */
export function CounterDiffRow({
  label,
  before,
  after,
  beforeCaption,
  afterCaption,
}: CounterDiffRowProps): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-[10px] border-b border-solid border-border-hairline py-[10px] text-[12.5px] last:border-b-0">
      <div className="shrink-0 font-semibold">{label}</div>
      <div className="text-right">
        <span className="block text-[11px] text-trust-gray line-through">
          <span className="sr-only">Was: </span>
          {before}
          {beforeCaption === undefined ? '' : ` — ${beforeCaption}`}
        </span>
        <span className="font-semibold text-success-on-soft">
          <span className="sr-only">Now: </span>
          {after}
          {afterCaption === undefined ? '' : ` — ${afterCaption}`}
        </span>
      </div>
    </div>
  );
}
