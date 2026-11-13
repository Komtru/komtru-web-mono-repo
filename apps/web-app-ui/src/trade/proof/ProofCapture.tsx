'use client';

// PM-1, PM-3 and PM-4: the seller shows the item. What is required is visible before anything is uploaded, a photo that
// needs another look is said plainly with one way forward, and once the requirement is met the screen says what happens
// to the media next. Each file goes straight to storage through a signed ticket and is attached by id, so what the
// platform holds is a reference to a private file, never bytes it relayed.
import { UploadError, uploadFile } from '@komtru/api-client';
import { useApiClient } from '@komtru/api-client/react';
import {
  Banner,
  Button,
  Chip,
  NoteBanner,
  OfflineBanner,
  RiskBanner,
  SectionLabel,
  TermList,
  TermRow,
  VersionTimeline,
} from '@komtru/ui-kit';
import { useRef, useState } from 'react';
import { CameraSheet } from './CameraSheet';
import { cameraSupported } from './camera';
import { type GridItem, MediaGrid } from './MediaGrid';
import { useOnline } from './online';
import { checkMedia, fingerprint, ofLabel, proofProgress, readDimensions, type Needs } from './rules';

/** The file the platform stores the seller's proof under: private to the trade, never public. */
const PROOF = { category: 'OTHER', visibility: 'PRIVATE_CASE' } as const;

export interface Attached {
  id: string;
  fileId: string;
  kind?: 'photo' | 'video';
  alt?: string;
  /** A preview of the file while it is on this device. */
  src?: string;
  /** What the file is, so the same one added twice is noticed. */
  fp?: string;
}

export interface ProofCaptureProps {
  /** What the category's standard asks for before the trade can go on. Zero photos and no video is no gate. */
  needs: Needs;
  /** Told the ids of everything attached and how many are photos and videos, on every change. */
  onChange: (fileIds: string[], counts: { photos: number; videos: number }, media: Attached[]) => void;
  /** What was attached before this mounted, so a screen that unmounts it between stages does not lose or hide files. */
  initial?: Attached[];
  /** What the locked banner says: the gate guards a send, an acceptance or a counter. */
  step: 'send' | 'accept';
}

interface Flagged {
  id: string;
  name: string;
  note: string;
  src: string | undefined;
}

const preview = (file: File): string | undefined =>
  typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined;

const PICK_CLASS =
  'focus-within:outline-[2.5px] focus-within:outline-trust-indigo focus-within:outline-offset-[2px]';

const plural = (count: number, word: string): string => `${String(count)} ${word}${count === 1 ? '' : 's'}`;
const spoken = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const say = (count: number): string => spoken[count] ?? String(count);

/** "Four photos and one video, added from this device." as the reference words it. */
function readyLine(counts: { photos: number; videos: number }): string {
  const parts = [
    counts.photos > 0 ? plural(counts.photos, 'photo') : undefined,
    counts.videos > 0 ? plural(counts.videos, 'video') : undefined,
  ].filter((part): part is string => part !== undefined);
  const words = parts.map((part) => {
    const [n = '', ...rest] = part.split(' ');
    return [say(Number(n)), ...rest].join(' ');
  });
  const line = words.join(' and ');
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}, added from this device.`;
}

export function ProofCapture({ needs, onChange, initial = [], step }: ProofCaptureProps): React.JSX.Element {
  const client = useApiClient();
  const online = useOnline();
  const [media, setMedia] = useState<Attached[]>(initial);
  const [busy, setBusy] = useState(0);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [flagged, setFlagged] = useState<Flagged | undefined>(undefined);
  const [camera, setCamera] = useState(false);
  // Ids start at 1 and never repeat, so removing one and adding another cannot reuse a slot's key.
  const counter = useRef(
    initial.reduce((top, item) => Math.max(top, Number(item.id.replace('proof-', '')) || 0), 0),
  );
  // What is attached, kept current between the awaits of one batch (state alone would be a render behind).
  const attached = useRef<Attached[]>(initial);

  const counts = {
    photos: media.filter((item) => item.kind !== 'video').length,
    videos: media.filter((item) => item.kind === 'video').length,
  };
  const progress = proofProgress(counts, needs);
  const required = needs.photos + (needs.video ? 1 : 0);

  const report = (next: Attached[]) => {
    attached.current = next;
    setMedia(next);
    onChange(
      next.map((item) => item.fileId),
      {
        photos: next.filter((item) => item.kind !== 'video').length,
        videos: next.filter((item) => item.kind === 'video').length,
      },
      next,
    );
  };

  const add = async (files: File[]) => {
    setFailure(undefined);
    setBusy((count) => count + files.length);
    for (const file of files) {
      try {
        const size = await readDimensions(file);
        const check = checkMedia(
          { name: file.name, type: file.type, size: file.size, lastModified: file.lastModified, ...size },
          attached.current.flatMap((item) => (item.fp === undefined ? [] : [item.fp])),
        );
        if (!check.ok) {
          setFlagged({
            id: `flag-${file.name}`,
            name: file.name,
            note: check.note ?? '',
            src: preview(file),
          });
          continue;
        }
        const fileId = await uploadFile(client, file, PROOF);
        counter.current += 1;
        const src = preview(file);
        const kind = file.type.startsWith('video/') ? 'video' : 'photo';
        report([
          ...attached.current,
          {
            id: `proof-${String(counter.current)}`,
            fileId,
            kind,
            alt: file.name,
            fp: fingerprint(file),
            ...(src === undefined ? {} : { src }),
          },
        ]);
        setFlagged(undefined);
      } catch (error) {
        setFailure(
          error instanceof UploadError && error.reason === 'TOO_LARGE'
            ? `${file.name} is too large. Choose a smaller file.`
            : `${file.name} didn't upload. Check your connection and add it again.`,
        );
      } finally {
        setBusy((count) => count - 1);
      }
    }
  };

  const items: GridItem[] = [
    ...media.map((item, index) => ({
      id: item.id,
      kind: item.kind ?? 'photo',
      label: item.alt ?? `Attachment ${String(index + 1)}`,
      ...(item.src === undefined ? {} : { src: item.src }),
    })),
    ...(flagged === undefined
      ? []
      : [
          {
            id: flagged.id,
            kind: 'photo' as const,
            label: flagged.name,
            flagged: true,
            ...(flagged.src === undefined ? {} : { src: flagged.src }),
          },
        ]),
  ];

  const verb = step === 'send' ? 'send this proposal' : 'accept';
  const takeEnabled = online && busy === 0;
  const retake = cameraSupported() ? (
    <Button
      type="button"
      disabled={!takeEnabled}
      onClick={() => {
        setFlagged(undefined);
        setCamera(true);
      }}
    >
      {flagged === undefined ? 'Take a photo now' : 'Retake this photo'}
    </Button>
  ) : (
    // No camera to open: the device's own camera app takes the picture and hands it back, so it is still taken now.
    <Button asChild>
      <label className={`block text-center ${PICK_CLASS}`}>
        {flagged === undefined ? 'Take a photo now' : 'Retake this photo'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={!takeEnabled}
          className="sr-only"
          onChange={(event) => {
            setFlagged(undefined);
            void add([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
      </label>
    </Button>
  );

  const picker = (
    <Button asChild variant="secondary">
      <label className={`block text-center ${PICK_CLASS}`}>
        {busy > 0 ? 'Uploading…' : 'Choose from my gallery'}
        <input
          type="file"
          multiple
          accept="image/*,video/*"
          disabled={!online}
          className="sr-only"
          onChange={(event) => {
            void add([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
      </label>
    </Button>
  );

  return (
    <div className="mb-[14px]">
      {!online && (
        <OfflineBanner title="You’re offline">
          Photos can’t be added until you’re back online. What you’ve added is kept here.
        </OfflineBanner>
      )}
      {failure !== undefined && <RiskBanner>{failure}</RiskBanner>}
      {flagged !== undefined ? (
        // PM-3: plain, non-accusing wording; one clear way forward.
        <>
          <h3 className="mb-[3px] font-display text-[19px] font-semibold tracking-[-.01em]">
            One photo needs replacing
          </h3>
          <p className="mb-[16px] text-[12.5px] leading-[1.55] text-slate">
            We check uploads so buyers can trust what they see. This one needs another look.
          </p>
        </>
      ) : progress.ready && media.length > 0 ? (
        // PM-4
        <>
          <h3 className="mb-[3px] font-display text-[19px] font-semibold tracking-[-.01em]">
            Your proof is ready
          </h3>
          <p className="mb-[16px] text-[12.5px] leading-[1.55] text-slate">{readyLine(counts)}</p>
        </>
      ) : (
        // PM-1
        <>
          <h3 className="mb-[3px] font-display text-[19px] font-semibold tracking-[-.01em]">
            Show the item as it really is
          </h3>
          <p className="mb-[16px] text-[12.5px] leading-[1.55] text-slate">
            This is what the buyer relies on — and what protects you if there’s ever a question.
          </p>
        </>
      )}

      {flagged === undefined && !progress.ready && (
        <>
          <NoteBanner>
            Items with clear photos build immediate trust with buyers and have fewer disputes. Take the photos
            yourself, in good light.
          </NoteBanner>
          <Banner tone="warning" title="Proof of the item needed">
            {media.length === 0
              ? `Attach ${plural(needs.photos, 'photo')}${needs.video ? ' and a video' : ' or video'} of the item in your possession before you can ${verb}.`
              : `Attach ${String(Math.max(required - media.length, 0) || 1)} more before you can ${verb}.`}
          </Banner>
        </>
      )}

      {required > 0 && flagged === undefined && (
        <>
          {!(progress.ready && media.length > 0) && <SectionLabel>What’s required</SectionLabel>}
          <TermList aria-label="What’s required">
            <TermRow label="Photos">
              <Chip tone={progress.photos.met ? 'verified' : 'awaiting'}>
                {ofLabel(progress.photos)}
                {progress.photos.met ? ' ✓' : ''}
              </Chip>
            </TermRow>
            {needs.video && (
              <TermRow label="Video">
                <Chip tone={progress.video.met ? 'verified' : 'awaiting'}>
                  {ofLabel(progress.video)}
                  {progress.video.met ? ' ✓' : ''}
                </Chip>
              </TermRow>
            )}
          </TermList>
        </>
      )}

      <MediaGrid
        aria-label="Proof of the item"
        items={items}
        slots={Math.max(required, 3)}
        onRemove={(id) => {
          if (id === flagged?.id) setFlagged(undefined);
          else report(media.filter((item) => item.id !== id));
        }}
        className="mt-[10px]"
      />

      {flagged !== undefined && (
        <>
          <Banner tone="risk" title={flagged.name}>
            {flagged.note}
          </Banner>
          <NoteBanner>
            Took it yourself? Retake it with your camera — it only takes a moment. Asking a person to review a
            photo isn’t in the app yet.
          </NoteBanner>
          <SectionLabel>Why this matters</SectionLabel>
          <TermList aria-label="Why this matters">
            <TermRow label="Buyers rely on it">It’s the Trade’s proof</TermRow>
            <TermRow label="If it’s ever disputed">It’s what we compare against</TermRow>
          </TermList>
          <p className="mt-[6px] mb-[12px] text-[11.5px] leading-[1.6] text-trust-gray">
            AI-generated, stock and downloaded images aren’t accepted.
          </p>
        </>
      )}

      {progress.ready && media.length > 0 && flagged === undefined && step === 'send' && (
        <>
          <SectionLabel>What happens next</SectionLabel>
          <VersionTimeline
            aria-label="What happens next"
            className="mb-[14px]"
            steps={[
              {
                id: 'review',
                title: 'The buyer reviews it with the offer',
                detail: 'Video first, then photos',
                state: 'done',
              },
              {
                id: 'change',
                title: 'You can change it until they accept',
                detail: 'Free to retake or replace',
                state: 'active',
              },
              {
                id: 'lock',
                title: 'It’s locked when the Trade is agreed',
                detail: 'It becomes the Trade’s evidence',
                state: 'pending',
              },
            ]}
          />
        </>
      )}

      <div className="flex flex-col gap-[8px]">
        {retake}
        {flagged === undefined && picker}
        {flagged !== undefined && (
          <Button
            type="button"
            variant="ghost"
            className="mx-auto"
            onClick={() => {
              setFlagged(undefined);
            }}
          >
            Remove it
          </Button>
        )}
      </div>

      <CameraSheet
        open={camera}
        onClose={() => {
          setCamera(false);
        }}
        photosTaken={counts.photos}
        videoNeeded={needs.video && counts.videos === 0}
        onShot={(file) => {
          void add([file]);
        }}
        onPick={(files) => {
          void add(files);
        }}
        onVideo={(file) => {
          void add([file]);
        }}
      />
    </div>
  );
}
