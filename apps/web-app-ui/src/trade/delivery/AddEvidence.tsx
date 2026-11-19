'use client';

import type { UploadTarget } from '@komtru/shared-types';
import {
  EVIDENCE_CONTENT_TYPES,
  EVIDENCE_OPEN_STATUSES,
  evidenceEventsFor,
  MAX_EVIDENCE_PER_ATTACH,
  ProblemError,
  UploadError,
  uploadFile,
  type EvidenceEvent,
  type TradeView,
} from '@komtru/api-client';
import { useApiClient, useAttachEvidence } from '@komtru/api-client/react';
import {
  ActionStack,
  Button,
  FileDropzone,
  NoteBanner,
  OfflineBanner,
  OptionCard,
  RiskBanner,
  SectionLabel,
  StatusHero,
  type MediaItem,
} from '@komtru/ui-kit';
import { useEffect, useRef, useState } from 'react';
import { useOnline } from '../../shell/OfflineStatus';
import { platformWords } from '../format';
import { evidenceHref } from '../workspace-state';
import { EVENT_LABEL, EVENT_ORDER } from './evidence-events';
import { Frame, Refusal, TradeGate, tradeHref } from './parts';

const TITLE = 'Add Evidence';
/** Evidence is private to the trade: the files are the person's own, shared with the other side only by the platform. */
// Evidence attached to a reported problem is DISPUTE_EVIDENCE — the category the resolution
// flow reads. `OTHER` was both the wrong name for it and a pair the platform refuses.
const EVIDENCE: UploadTarget = { category: 'DISPUTE_EVIDENCE', visibility: 'PRIVATE_CASE' };
const PROSE = 'Choose the event and attach the media that supports your trade record or case.';
/** A file the platform is still checking is asked for again, a few times, before the person is told to wait. */
const PROCESSING_TRIES = 6;
const PROCESSING_WAIT_MS = 1500;

interface Added extends MediaItem {
  fileId: string;
}

/**
 * CWT-S13: the owner's flow, upload first and then attach. Each file goes straight to private storage through a
 * signed ticket (`uploadFile`: ticket, bytes, finalize), and Submit sends the resulting file ids under the chosen
 * event. The platform lets each side add the events that are theirs (the dispatch is the seller's, the inspection
 * the buyer's), so a person is offered only those.
 */
export function AddEvidence({
  id,
  waitMs = PROCESSING_WAIT_MS,
}: {
  id: string;
  waitMs?: number;
}): React.JSX.Element {
  return (
    <TradeGate id={id} title={TITLE}>
      {(trade) =>
        (EVIDENCE_OPEN_STATUSES as readonly string[]).includes(trade.status) ? (
          <Form trade={trade} waitMs={waitMs} />
        ) : (
          <Refusal
            id={trade.id}
            title={TITLE}
            why="Evidence can be added while the item is on its way, being delivered, in inspection or under review. This trade isn’t at one of those stages."
          />
        )
      }
    </TradeGate>
  );
}

const isProcessing = (error: unknown): boolean =>
  error instanceof ProblemError && error.status === 409 && error.problem.reason === 'FILE_PROCESSING';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function Form({ trade, waitMs }: { trade: TradeView; waitMs: number }): React.JSX.Element {
  const client = useApiClient();
  const online = useOnline();
  const attach = useAttachEvidence();
  const allowed = EVENT_ORDER.filter((event) => evidenceEventsFor(trade.yourRole).includes(event));
  const [event, setEvent] = useState<EvidenceEvent | undefined>(allowed[0]);
  const [added, setAdded] = useState<Added[]>([]);
  const [uploading, setUploading] = useState(0);
  const [failures, setFailures] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<EvidenceEvent | undefined>(undefined);
  // What is added, kept current between the awaits of one batch (state alone would be a render behind).
  const current = useRef<Added[]>([]);
  const sent = useRef(false);
  // The wait-and-retry for a file still being checked must not keep calling the platform once the screen is gone.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const onAdd = async (files: File[]) => {
    const notes: string[] = [];
    setProblem(undefined);
    setUploading((count) => count + files.length);
    for (const file of files) {
      try {
        if (!(EVIDENCE_CONTENT_TYPES as readonly string[]).includes(file.type.toLowerCase())) {
          notes.push(`${file.name} can’t be added. Choose a photo (JPEG, PNG or WebP) or a PDF.`);
        } else if (current.current.length >= MAX_EVIDENCE_PER_ATTACH) {
          notes.push(
            `${file.name} wasn’t added. You can send up to ${String(MAX_EVIDENCE_PER_ATTACH)} files at a time.`,
          );
        } else {
          const fileId = await uploadFile(client, file, EVIDENCE);
          current.current = [
            ...current.current,
            {
              id: fileId,
              fileId,
              alt: file.name,
              kind: 'photo',
            },
          ];
          setAdded(current.current);
        }
      } catch (error) {
        notes.push(
          error instanceof UploadError && error.reason === 'TOO_LARGE'
            ? `${file.name} is too large. Choose a smaller file.`
            : `${file.name} didn’t upload. Check your connection and add it again.`,
        );
      } finally {
        setUploading((count) => count - 1);
      }
    }
    setFailures(notes);
  };

  const onSubmit = async () => {
    // One attach at a time: a double press must not send the files twice.
    if (event === undefined || current.current.length === 0 || sent.current) return;
    sent.current = true;
    setSending(true);
    setProblem(undefined);
    const fileIds = current.current.map((item) => item.fileId);
    try {
      for (let attempt = 1; ; attempt += 1) {
        try {
          await attach.mutateAsync({ id: trade.id, event, fileIds });
          setDone(event);
          return;
        } catch (error) {
          if (!isProcessing(error)) throw error;
          if (attempt >= PROCESSING_TRIES) {
            setProblem(
              'Your files are still being checked. Give it a minute and press Submit evidence again.',
            );
            return;
          }
          await sleep(waitMs);
          if (!mounted.current) return;
        }
      }
    } catch (error) {
      setProblem(platformWords(error, 'We couldn’t add your evidence. Check your connection and try again.'));
    } finally {
      sent.current = false;
      setSending(false);
    }
  };

  if (done !== undefined) {
    return (
      <Frame title={TITLE} id={trade.id}>
        <StatusHero tone="success" as="h2" title="Evidence added">
          {`${String(added.length)} ${added.length === 1 ? 'file is' : 'files are'} now kept with this trade under ${EVENT_LABEL[done].toLowerCase()}. The other side can see ${added.length === 1 ? 'it' : 'them'} too.`}
        </StatusHero>
        <ActionStack className="mt-[16px]">
          <Button asChild>
            <a href={evidenceHref(trade.id)}>View trade evidence</a>
          </Button>
          <Button asChild variant="secondary">
            <a href={tradeHref(trade.id)}>Back to trade</a>
          </Button>
        </ActionStack>
      </Frame>
    );
  }

  const busy = uploading > 0 || sending;
  return (
    <Frame title={TITLE} id={trade.id}>
      <p className="mb-[14px] text-[12.5px] leading-[1.6] text-slate">{PROSE}</p>
      {!online && (
        <OfflineBanner title="You’re offline">
          Photos and PDFs can’t be added until you’re back online. What you’ve added is kept here.
        </OfflineBanner>
      )}
      <fieldset className="mb-[14px] min-w-0 border-0 p-0">
        <legend className="mb-[8px] p-0">
          <SectionLabel>Evidence category</SectionLabel>
        </legend>
        {allowed.map((option) => (
          <OptionCard
            key={option}
            name="evidence-event"
            value={option}
            checked={event === option}
            disabled={sending}
            onChange={() => {
              setEvent(option);
            }}
          >
            {EVENT_LABEL[option]}
          </OptionCard>
        ))}
      </fieldset>
      <SectionLabel>Files</SectionLabel>
      {failures.map((note) => (
        <RiskBanner key={note}>{note}</RiskBanner>
      ))}
      <FileDropzone
        label={uploading > 0 ? 'Uploading…' : 'Add photos or PDFs'}
        hint="Stored with this trade"
        media={added}
        requiredCount={0}
        accept={EVIDENCE_CONTENT_TYPES.join(',')}
        onAdd={online && !sending ? (files) => void onAdd(files) : undefined}
        {...(sending
          ? {}
          : {
              onRemove: (fileId: string) => {
                current.current = current.current.filter((item) => item.id !== fileId);
                setAdded(current.current);
              },
            })}
      />
      <span role="status" className="sr-only">
        {uploading > 0 ? 'Uploading your files' : ''}
      </span>
      <NoteBanner>
        Files stay private to this trade. Only you and the other side can see what is added.
      </NoteBanner>
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <ActionStack className="mt-[16px]">
        <Button
          type="button"
          disabled={!online || busy || added.length === 0 || event === undefined}
          onClick={() => void onSubmit()}
        >
          {sending ? 'Submitting…' : 'Submit evidence'}
        </Button>
        <Button asChild variant="secondary">
          <a href={evidenceHref(trade.id)}>Cancel</a>
        </Button>
      </ActionStack>
    </Frame>
  );
}
