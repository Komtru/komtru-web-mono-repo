'use client';

import { type Attached, ProofCapture } from './proof/ProofCapture';

export type { Attached };

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
 * The seller's proof of the item: photos or video of it in their possession (W1). F-029 made this the capture-and-
 * check component (`proof/ProofCapture`); this keeps the props every screen that asks for proof already passes.
 */
export function ProofUpload({
  required,
  requireVideo = false,
  onChange,
  initial,
  step,
}: ProofUploadProps): React.JSX.Element {
  return (
    <ProofCapture
      needs={{ photos: required, video: requireVideo }}
      onChange={onChange}
      step={step}
      {...(initial === undefined ? {} : { initial })}
    />
  );
}
