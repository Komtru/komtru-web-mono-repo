'use client';

// PM-5 and PM-7: how the buyer looks at the seller's proof. At the request stage (PM-5) the seller's own media lead the
// offer with who showed them and when it can no longer change; at inspection (PM-7) the agreed proof sits beside the
// buyer's own photos with the checks to make. The seller's files are the platform's (signed per file, never kept);
// the buyer's own photos stay on this device, a compare aid and not evidence, and the screen says so.
import type { useInspection } from '@komtru/api-client/react';
import { NoteBanner, SectionLabel, TermList, TermRow } from '@komtru/ui-kit';
import { useState } from 'react';
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
          title={`${seller} showed ${`${String(total)} ${total === 1 ? 'photo or video' : 'photos or videos'}`}`}
        >
          They open once the Trade is agreed, and they’re what the item is compared with at inspection.
        </NoteBanner>
      )}
      <TermList aria-label="Where the proof came from">
        <TermRow label="Shown by">{seller}</TermRow>
        {taken !== undefined && <TermRow label="Taken">{taken}</TermRow>}
        <TermRow label="Can the seller change it?">Until you accept</TermRow>
      </TermList>
      <NoteBanner>
        When you accept, this proof is saved with the Trade as its evidence. If the item arrives different,
        it’s what we compare against.
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

/** PM-7: the seller's agreed proof beside the buyer's own photos, with the checks to make. */
export function InspectCompare({ read, seller }: { read: Read; seller: string }): React.JSX.Element {
  const [side, setSide] = useState<'seller' | 'mine'>('seller');
  const [mine, setMine] = useState<Mine[]>([]);
  const items: GridItem[] = mine.map((photo) => ({
    id: photo.id,
    kind: 'photo',
    label: photo.name,
    ...(photo.src === undefined ? {} : { src: photo.src }),
  }));

  const choose = (files: File[]) => {
    setMine((current) => [
      ...current,
      ...files
        .filter((file) => file.type.startsWith('image/'))
        .map((file, index) => ({
          id: `mine-${String(current.length + index)}-${file.name}`,
          name: file.name,
          src: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined,
        })),
    ]);
  };

  return (
    <div>
      <div role="group" aria-label="Which photos to look at" className="mb-[16px] flex gap-[8px]">
        {(['seller', 'mine'] as const).map((which) => (
          <button
            key={which}
            type="button"
            aria-pressed={side === which}
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

      {side === 'seller' ? (
        <SellerProof read={read} seller={seller} />
      ) : (
        <section aria-label="My photos">
          <MediaGrid
            aria-label="My photos"
            items={items}
            slots={4}
            columns={4}
            onRemove={(id) => {
              setMine((current) => current.filter((photo) => photo.id !== id));
            }}
          />
          <p className="mb-[10px] text-[11.5px] leading-[1.6] text-trust-gray">
            Your photos go here. Include the IMEI screen. They stay on this device to compare with; they
            aren’t sent to Komtru.
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
      )}
    </div>
  );
}

/** "Does it match?": what to check the item against the proof for. A reminder; the platform does not read it. */
export function MatchChecks(): React.JSX.Element {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  return (
    <div>
      <SectionLabel>Does it match?</SectionLabel>
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
                  setChecked((current) => {
                    const next = new Set(current);
                    if (on) next.delete(check);
                    else next.add(check);
                    return next;
                  });
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
