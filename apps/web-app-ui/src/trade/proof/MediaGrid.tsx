'use client';

// The reference's `.proof-media-grid` of `.proof-thumb`s, one component for every place proof appears: the seller's
// own capture (local previews, removable, flagged), the buyer's review and compare, the evidence trail and the record
// (signed private files). A tile is a file the platform holds (`fileId`, signed on demand and never kept) or a file
// still on this device (`src`, an object URL).
import { useFileUrl } from '@komtru/api-client/react';
import { Skeleton } from '@komtru/ui-kit';

export interface GridItem {
  id: string;
  kind?: 'photo' | 'video';
  /** What a screen reader hears: "Photo 2", "photo_2.jpg". */
  label: string;
  /** A file the platform holds. */
  fileId?: string;
  /** A file still on this device. */
  src?: string;
  /** The check found something: drawn with the risk outline. */
  flagged?: boolean;
}

const TILE = 'relative aspect-square w-full overflow-hidden rounded-[10px]';
const FILL = 'bg-[linear-gradient(135deg,var(--stone-gray),var(--cloud-gray))]';

const PlayBadge = (): React.JSX.Element => (
  <span
    aria-hidden
    className="absolute right-[6px] bottom-[6px] flex h-[20px] w-[20px] items-center justify-center rounded-[50%] bg-[rgba(13,20,32,.75)]"
  >
    <svg viewBox="0 0 24 24" className="h-[9px] w-[9px] fill-pure-white stroke-none">
      <path d="M8 5v14l11-7z" />
    </svg>
  </span>
);

/** A file the platform holds, signed when it is shown. Says so when it cannot be loaded, and offers another try. */
export function FileTile({ fileId, label }: { fileId: string; label: string }): React.JSX.Element {
  const file = useFileUrl(fileId);
  const frame = `${TILE} border border-solid border-border-hairline bg-surface-secondary object-cover`;
  if (file.isPending) return <Skeleton width="full" lines={3} />;
  if (file.isError) {
    return (
      <p
        role="alert"
        className="flex aspect-square items-center justify-center rounded-md bg-surface-secondary p-[8px] text-center text-[11px] text-risk-on-soft"
      >
        <span>
          {label} didn’t load.{' '}
          <button type="button" className="underline" onClick={() => void file.refetch()}>
            Try again
          </button>
        </span>
      </p>
    );
  }
  return file.data.contentType.startsWith('video/') ? (
    <video src={file.data.url} controls className={frame} aria-label={label}>
      {/* Proof video is camera footage with nothing said in it: there is no caption file to point at. */}
      <track kind="captions" label="No captions" />
    </video>
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not an optimisable asset
    <img src={file.data.url} alt={label} className={frame} />
  );
}

function Tile({ item, onRemove }: { item: GridItem; onRemove: ((id: string) => void) | undefined }) {
  if (item.fileId !== undefined) return <FileTile fileId={item.fileId} label={item.label} />;
  return (
    <div
      className={`${TILE} ${FILL}${item.flagged === true ? ' outline outline-2 -outline-offset-2 outline-risk' : ''}`}
    >
      {/* A video still on this device is drawn as a dark tile with the play badge: a preview frame would need a decoder. */}
      {item.src !== undefined && item.kind !== 'video' ? (
        // eslint-disable-next-line @next/next/no-img-element -- an object URL for a file on this device
        <img src={item.src} alt={item.label} className="h-full w-full object-cover" />
      ) : (
        <span className="sr-only">{item.label}</span>
      )}
      {item.kind === 'video' && <PlayBadge />}
      {onRemove !== undefined && (
        <button
          type="button"
          aria-label={`Remove ${item.label}`}
          onClick={() => {
            onRemove(item.id);
          }}
          className="absolute top-[6px] right-[6px] flex h-[20px] w-[20px] items-center justify-center rounded-[50%] border-none bg-[rgba(13,20,32,.75)] text-[11px] leading-none text-pure-white focus-visible:outline-[2.5px] focus-visible:outline-trust-indigo"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth={2.4}
            strokeLinecap="round"
            className="h-[9px] w-[9px] stroke-pure-white"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}

const PlusIcon = (): React.JSX.Element => (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth={1.8}
    strokeLinecap="round"
    className="h-[18px] w-[18px] stroke-trust-gray"
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export interface MediaGridProps {
  items: readonly GridItem[];
  /** Empty dashed slots drawn after the items until this many tiles are shown (what is still to add). */
  slots?: number;
  onRemove?: (id: string) => void;
  'aria-label': string;
  /** Four to a row where the screen is wide and the tiles are small (the compare), three otherwise. */
  columns?: 3 | 4;
  className?: string;
}

/** The grid itself: `.proof-media-grid`. An ordered list, because the order the shots were taken in is the order shown. */
export function MediaGrid({
  items,
  slots = 0,
  onRemove,
  columns = 3,
  className = '',
  'aria-label': ariaLabel,
}: MediaGridProps): React.JSX.Element {
  const empty = Math.max(slots - items.length, 0);
  return (
    <ul
      aria-label={ariaLabel}
      className={`mb-[14px] grid list-none gap-[8px] p-0 ${columns === 4 ? 'grid-cols-[repeat(4,1fr)]' : 'grid-cols-[repeat(3,1fr)]'} ${className}`}
    >
      {items.map((item) => (
        <li key={item.id}>
          <Tile item={item} onRemove={onRemove} />
        </li>
      ))}
      {Array.from({ length: empty }, (_, index) => (
        <li
          key={`empty-${String(index)}`}
          aria-hidden
          className="flex aspect-square items-center justify-center rounded-[10px] border-[1.5px] border-dashed border-border-hairline bg-surface-primary"
        >
          <PlusIcon />
        </li>
      ))}
    </ul>
  );
}
