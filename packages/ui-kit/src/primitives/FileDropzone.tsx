'use client';

import { Banner } from './Banner.js';
import { cx } from './cx.js';

export interface MediaItem {
  id: string;
  /** The reference marks a video thumb with a play badge; a photo carries none. */
  kind?: 'photo' | 'video';
  alt?: string;
}

/** The gate the seller's Accept Trade screen enforces: no acceptance without proof of possession. */
export function isMediaGateSatisfied(media: readonly MediaItem[], requiredCount: number): boolean {
  return media.length >= requiredCount;
}

export interface MediaGateProps {
  media: readonly MediaItem[];
  requiredCount: number;
  children: (satisfied: boolean) => React.ReactNode;
}

/**
 * Computes the gate once and hands the answer to a render prop, so a screen states the rule in one
 * place instead of recomputing `media.length >= n` beside every action. It does not *enforce* the
 * gate — a child is free to ignore the argument — it only makes the honest version the short one.
 */
export function MediaGate({ media, requiredCount, children }: MediaGateProps): React.ReactNode {
  return children(isMediaGateSatisfied(media, requiredCount));
}

const SLOT_GRIDS = {
  2: 'grid-cols-[repeat(2,1fr)]',
  3: 'grid-cols-[repeat(3,1fr)]',
  4: 'grid-cols-[repeat(4,1fr)]',
} as const;

export interface FileDropzoneProps {
  /** The call to action in the box: "Add evidence photos", "Tap to upload a document". */
  label: string;
  /** The line under it, saying why it helps. */
  hint?: string;
  media: readonly MediaItem[];
  /**
   * How much proof the screen demands. Zero — the default — means the upload is optional evidence,
   * which is what most of them are; above zero the gate banner states what is still missing and
   * stays until it is not.
   */
  requiredCount?: number;
  slots?: 2 | 3 | 4;
  accept?: string;
  onAdd?: (files: File[]) => void;
  className?: string;
}

/**
 * `.m-upload` plus the `.proof-media-grid` of `.proof-thumb`s above it, and — when the screen sets a
 * `requiredCount` — the `.guard-lock-banner` that names what is still missing. The reference's W1:
 * "Attach at least one photo or video showing the item in your possession before you can accept."
 */
export function FileDropzone({
  label,
  hint,
  media,
  requiredCount = 0,
  slots = 3,
  accept = 'image/*,video/*',
  onAdd,
  className,
}: FileDropzoneProps): React.JSX.Element {
  const satisfied = isMediaGateSatisfied(media, requiredCount);
  const missing = Math.max(requiredCount - media.length, 0);

  return (
    <div className={cx('mb-[14px]', className)}>
      {!satisfied && (
        <Banner tone="warning" title="Accept is locked">
          {media.length === 0
            ? 'Attach at least one photo or video showing the item in your possession before you can accept.'
            : `Attach ${String(missing)} more showing the item in your possession before you can accept.`}
        </Banner>
      )}
      <ul className={cx('mb-[14px] grid gap-[8px]', SLOT_GRIDS[slots])}>
        {Array.from({ length: Math.max(slots, media.length) }, (_, index) => {
          const item = media[index];
          return (
            <li
              key={item?.id ?? `empty-${String(index)}`}
              className={cx(
                'relative flex aspect-[1] items-center justify-center rounded-[10px]',
                item === undefined
                  ? 'border-[1.5px] border-dashed border-border-hairline bg-surface-primary'
                  : 'bg-[linear-gradient(135deg,var(--stone-gray),var(--cloud-gray))]',
              )}
            >
              {item === undefined ? (
                <PlusIcon className="h-[18px] w-[18px] stroke-trust-gray" />
              ) : (
                <>
                  <span className="sr-only">{item.alt ?? `Attachment ${String(index + 1)}`}</span>
                  {item.kind === 'video' && <PlayBadge />}
                </>
              )}
            </li>
          );
        })}
      </ul>
      <label
        className={cx(
          'block cursor-pointer rounded-md border-[1.5px] border-dashed border-border-hairline',
          'bg-surface-primary p-[16px] text-center',
          'focus-within:outline-[2.5px] focus-within:outline-trust-indigo focus-within:outline-offset-[2px]',
        )}
      >
        <PlusIcon className="mx-auto mb-[6px] h-[20px] w-[20px] stroke-trust-gray" />
        <b className="block text-[12px]">{label}</b>
        {hint !== undefined && <span className="text-[10.5px] text-slate">{hint}</span>}
        <input
          type="file"
          multiple
          accept={accept}
          className="sr-only"
          onChange={(event) => {
            onAdd?.([...(event.target.files ?? [])]);
          }}
        />
      </label>
    </div>
  );
}

/** `.proof-thumb .play-badge` — the corner marker that tells a video thumbnail from a photo one. */
function PlayBadge(): React.JSX.Element {
  return (
    <span
      aria-hidden
      className="absolute right-[6px] bottom-[6px] flex h-[20px] w-[20px] items-center justify-center rounded-[50%] bg-[rgba(13,20,32,.75)]"
    >
      <svg viewBox="0 0 24 24" className="h-[9px] w-[9px] fill-pure-white stroke-none">
        <path d="M8 5v14l11-7z" />
      </svg>
    </span>
  );
}

function PlusIcon({ className }: { className: string }): React.JSX.Element {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={1.8}
      strokeLinecap="round"
      className={className}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
