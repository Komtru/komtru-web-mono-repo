'use client';

import { UploadError, uploadFile } from '@komtru/api-client';
import { useApiClient } from '@komtru/api-client/react';
import { FileDropzone, type MediaItem, RiskBanner } from '@komtru/ui-kit';
import { useRef, useState } from 'react';

/** The file the platform stores the seller's proof under: private to the trade, never public. */
const PROOF = { category: 'OTHER', visibility: 'PRIVATE_CASE' } as const;

export interface Attached extends MediaItem {
  fileId: string;
}

export interface ProofUploadProps {
  /** How many photos the category's standard asks for before the trade can go on. 0 is no gate. */
  required: number;
  /** A video is required as well as the photos. */
  requireVideo?: boolean;
  /** Told the ids of everything attached and how many are photos and videos, on every change. */
  onChange: (fileIds: string[], counts: { photos: number; videos: number }, media: Attached[]) => void;
  /** What was attached before this mounted, so a screen that unmounts it between stages does not lose or hide files. */
  initial?: Attached[];
  /** What the locked banner says: the gate guards a send, an acceptance or a counter. */
  step: 'send' | 'accept';
}

/**
 * The seller's proof of the item: photos or video of it in their possession (W1). Each file goes
 * straight to storage through a signed ticket and is attached by id, so what the platform holds is a
 * reference to a private file, never bytes it relayed.
 */
export function ProofUpload({
  required,
  requireVideo = false,
  onChange,
  initial = [],
  step,
}: ProofUploadProps): React.JSX.Element {
  const client = useApiClient();
  const [media, setMedia] = useState<Attached[]>(initial);
  const [busy, setBusy] = useState(0);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  // Ids start at 1 and never repeat, so removing one and adding another cannot reuse a slot's key.
  const counter = useRef(
    initial.reduce((top, item) => Math.max(top, Number(item.id.replace('proof-', '')) || 0), 0),
  );

  const report = (next: Attached[]) => {
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
    let current = media;
    for (const file of files) {
      try {
        const fileId = await uploadFile(client, file, PROOF);
        counter.current += 1;
        current = [
          ...current,
          {
            id: `proof-${String(counter.current)}`,
            fileId,
            kind: file.type.startsWith('video/') ? 'video' : 'photo',
            alt: file.name,
          },
        ];
        report(current);
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

  const verb = step === 'send' ? 'send this proposal' : 'accept';

  return (
    <div>
      {failure !== undefined && <RiskBanner>{failure}</RiskBanner>}
      <FileDropzone
        label={busy > 0 ? 'Uploading…' : 'Add photos or a video of the item'}
        hint="Taken now, showing the item in your possession"
        media={media}
        requiredCount={required + (requireVideo ? 1 : 0)}
        accept="image/*,video/*"
        onAdd={(files) => void add(files)}
        onRemove={(id) => {
          report(media.filter((item) => item.id !== id));
        }}
        locked={{
          title: 'Proof of the item needed',
          message: (attached, missing) =>
            attached === 0
              ? `Attach ${String(required)} photo${required === 1 ? '' : 's'}${requireVideo ? ' and a video' : ' or video'} of the item in your possession before you can ${verb}.`
              : `Attach ${String(missing)} more before you can ${verb}.`,
        }}
      />
    </div>
  );
}
