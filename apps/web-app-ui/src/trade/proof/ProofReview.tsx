'use client';

// PM-5 and PM-7: how the buyer looks at the seller's proof. At the request stage (PM-5) the seller's own media lead the
// offer with who showed them and when it can no longer change; at inspection (PM-7) the agreed proof sits beside the
// buyer's own photos with the checks to make. The seller's files are the platform's (signed per file, never kept);
// the buyer's own photos stay on this device, a compare aid and not evidence, and the screen says so.
import type { useInspection } from '@komtru/api-client/react';
import { NoteBanner, SectionLabel, TermList, TermRow } from '@komtru/ui-kit';
import { useEffect, useId, useRef, useState } from 'react';
import { whenLabel } from '../format';
import { SellerProof } from '../inspection/Proof';
import { type GridItem, MediaGrid } from './MediaGrid';

type Read = NonNullable<ReturnType<typeof useInspection>['data']>;

/** "29 Sep, 16:42 – 16:58" from the first and last time a file was attached; one time when they are the same. */
export function takenRange(times: readonly (string | undefined)[]): string | undefined {
  const stamps = times
    .filter((time): time is string => time !== undefined)
    .map((time) => ({ time, ms: new Date(time).getTime() }))
    .filter((stamp) => !Number.isNaN(stamp.ms))
    .sort((a, b) => a.ms - b.ms);
  const first = stamps[0];
  const last = stamps[stamps.length - 1];
  if (first === undefined || last === undefined) return undefined;
  const start = whenLabel(first.time);
  const end = whenLabel(last.time);
  if (start === end) return start;
  // The reference writes the day once: "29 Sep · 16:42 – 16:58".
  const [day = '', clock = ''] = start.split(' · ');
  const [endDay = '', endClock = ''] = end.split(' · ');
  return day === endDay ? `${day} · ${clock} – ${endClock}` : `${start} – ${end}`;
}

export interface ProofReviewProps {
  seller: string;
  /** How many files the seller attached: all a proposal says before the trade is agreed. */
  total: number;
  /** The files themselves, where the platform lets this person open them. */
  media?: readonly { fileId: string; attachedAt?: string }[];
}

/** PM-5: before accepting, the seller's own media with where they came from stated plainly. */
export function ProofReview({ seller, total, media = [] }: ProofReviewProps): React.JSX.Element {
  const items: GridItem[] = media.map((file, index) => ({
    id: file.fileId,
    fileId: file.fileId,
    label: `Seller’s proof ${String(index + 1)}`,
  }));
  const taken = takenRange(media.map((file) => file.attachedAt));
  return (
    <section aria-label="The seller’s proof">
      <SectionLabel>Proof of the item</SectionLabel>
      {total === 0 ? (
        <p className="mb-[14px] text-[12px] text-slate">{seller} hasn’t shown any photos or video.</p>
      ) : items.length > 0 ? (
        <MediaGrid aria-label="The seller’s proof" items={items} />
      ) : (
        <NoteBanner
          title={`${seller} attached ${String(total)} ${total === 1 ? 'photo or video' : 'photos or videos'}`}
        >
          This app can’t show them yet: the platform lists a Trade’s files only once the item has shipped. At
          inspection you compare the item with them.
        </NoteBanner>
      )}
      <TermList aria-label="Where the proof came from">
        <TermRow label="Shown by">{seller}</TermRow>
        {taken !== undefined && <TermRow label="Taken">{taken}</TermRow>}
      </TermList>
      <NoteBanner>
        This proof stays with the Trade as its evidence. At inspection, it’s what the item is compared with.
      </NoteBanner>
    </section>
  );
}

// ---------------------------------------------------------------------------
// PM-7
// ---------------------------------------------------------------------------

/** What the buyer checks the item against the proof for. Advisory: the platform does not read these. */
export const MATCH_CHECKS = [
  'Same colour and storage',
  'Same condition as the video',
  'IMEI matches the label',
  'Everything in the box is there',
] as const;

const PILL =
  'flex-1 rounded-full border-[1.5px] border-solid px-[12px] py-[8px] text-[12px] font-semibold focus-visible:outline-[2.5px] focus-visible:outline-trust-indigo focus-visible:outline-offset-[2px]';

interface Mine {
  id: string;
  name: string;
  src: string | undefined;
}

export interface MyPhotosState {
  items: GridItem[];
  choose: (files: File[]) => void;
  remove: (id: string) => void;
}

/** The buyer's own photos for the compare: kept on this device, previewed by object URL, released when the screen goes. */
export function useMyPhotos(): MyPhotosState {
  const [mine, setMine] = useState<Mine[]>([]);
  // Ids come from a counter that only goes up, so two photos with the same name never share a key or a Remove.
  const next = useRef(0);
  const live = useRef<Mine[]>([]);
  useEffect(() => {
    live.current = mine;
  }, [mine]);
  // The previews live as long as the compare does.
  useEffect(
    () => () => {
      if (typeof URL.revokeObjectURL !== 'function') return;
      live.current.forEach((photo) => {
        if (photo.src !== undefined) URL.revokeObjectURL(photo.src);
      });
    },
    [],
  );
  const items: GridItem[] = mine.map((photo) => ({
    id: photo.id,
    kind: 'photo',
    label: photo.name,
    ...(photo.src === undefined ? {} : { src: photo.src }),
  }));

  const choose = (files: File[]) => {
    const added = files
      .filter((file) => file.type.startsWith('image/'))
      .map((file) => {
        next.current += 1;
        return {
          id: `mine-${String(next.current)}`,
          name: file.name,
          src: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined,
        };
      });
    setMine((current) => [...current, ...added]);
  };

  const remove = (id: string) => {
    const gone = mine.find((photo) => photo.id === id);
    if (gone?.src !== undefined && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(gone.src);
    setMine((current) => current.filter((photo) => photo.id !== id));
  };
  return { items, choose, remove };
}

function MyPhotosView({ items, choose, remove }: MyPhotosState): React.JSX.Element {
  return (
    <section aria-label="My photos">
      <MediaGrid aria-label="My photos" items={items} slots={4} columns={4} onRemove={remove} />
      <p className="mb-[10px] text-[11.5px] leading-[1.6] text-trust-gray">
        Your photos go here. Include the IMEI screen. They stay on this device to compare with; they aren’t
        sent to Komtru.
      </p>
      <label className="mb-[14px] inline-flex cursor-pointer rounded-md border-[1.5px] border-solid border-border-hairline bg-surface-primary px-[14px] py-[10px] text-[12.5px] font-semibold focus-within:outline-[2.5px] focus-within:outline-trust-indigo focus-within:outline-offset-[2px]">
        Add my photos
        <input
          type="file"
          multiple
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            choose([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
      </label>
    </section>
  );
}

/** DX-23: the buyer's own photos on their own, where the seller's proof is drawn beside them rather than behind a toggle. */
export function MyPhotos({ photos }: { photos: MyPhotosState }): React.JSX.Element {
  return <MyPhotosView {...photos} />;
}

/**
 * PM-7: the seller's agreed proof beside the buyer's own photos, with the checks to make. On a phone and a tablet a
 * pair of pills swaps between them (TX-14: "instead of two cramped panes"); a desktop draws both side by side and
 * uses `SellerProof` and `MyPhotos` itself.
 */
export function InspectCompare({
  read,
  seller,
  photos,
}: {
  read: Read;
  seller: string;
  /** The buyer's photos, kept by the screen so they outlive a change of layout; the compare keeps its own if none. */
  photos?: MyPhotosState;
}): React.JSX.Element {
  const [side, setSide] = useState<'seller' | 'mine'>('seller');
  const own = useMyPhotos();
  const mine = photos ?? own;
  const panel = useId();

  return (
    <div>
      <div role="group" aria-label="Which photos to look at" className="mb-[16px] flex gap-[8px]">
        {(['seller', 'mine'] as const).map((which) => (
          <button
            key={which}
            type="button"
            aria-pressed={side === which}
            aria-controls={panel}
            onClick={() => {
              setSide(which);
            }}
            className={`${PILL} ${
              side === which
                ? 'border-trust-indigo bg-trust-indigo-soft text-trust-indigo'
                : 'border-border-hairline bg-surface-primary text-slate'
            }`}
          >
            {which === 'seller' ? 'Seller’s proof' : 'My photos'}
          </button>
        ))}
      </div>

      <div id={panel}>
        {side === 'seller' ? <SellerProof read={read} seller={seller} /> : <MyPhotosView {...mine} />}
      </div>
    </div>
  );
}

export interface MatchChecksState {
  checked: ReadonlySet<string>;
  toggle: (check: string) => void;
}

/** Which checks are ticked. Kept by the screen so a change of layout does not clear them. */
export function useMatchChecks(): MatchChecksState {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const toggle = (check: string) => {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(check)) next.delete(check);
      else next.add(check);
      return next;
    });
  };
  return { checked, toggle };
}

/** "Does it match?": what to check the item against the proof for. A reminder; the platform does not read it. */
export function MatchChecks({
  heading = true,
  as,
  state,
}: {
  heading?: boolean;
  /** The heading's level, one down from a panel's own. */
  as?: 'h2' | 'h3';
  state?: MatchChecksState;
} = {}): React.JSX.Element {
  const own = useMatchChecks();
  const { checked, toggle } = state ?? own;
  return (
    <div>
      {/* A panel that names the checks itself (TX-14's "Checks") has no use for a second heading. */}
      {heading && <SectionLabel {...(as === undefined ? {} : { as })}>Does it match?</SectionLabel>}
      <fieldset className="mb-[14px] min-w-0 border-0 p-0">
        <legend className="sr-only">Does it match?</legend>
        {MATCH_CHECKS.map((check) => {
          const on = checked.has(check);
          return (
            <label
              key={check}
              className={`mb-[8px] flex cursor-pointer items-center gap-[10px] rounded-md border-[1.5px] border-solid px-[14px] py-[12px] text-[12.5px] focus-within:outline-[2.5px] focus-within:outline-trust-indigo ${
                on ? 'border-trust-indigo bg-trust-indigo-soft' : 'border-border-hairline bg-surface-primary'
              }`}
            >
              <input
                type="checkbox"
                checked={on}
                className="h-[16px] w-[16px] shrink-0 accent-trust-indigo"
                onChange={() => {
                  toggle(check);
                }}
              />
              <span>{check}</span>
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}
