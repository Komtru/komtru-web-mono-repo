'use client';

import {
  UploadError,
  uploadFile,
  type MerchantApplication,
  type MerchantDocumentType,
} from '@komtru/api-client';
import { useApiClient, useMyMerchantApplication, useSaveMerchantDraft } from '@komtru/api-client/react';
import {
  Banner,
  Button,
  FileDropzone,
  RiskBanner,
  SectionLabel,
  TextField,
  type MediaItem,
} from '@komtru/ui-kit';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LoadProblem, Loading } from '../account/states';
import { SellFrame } from './Frame';
import { REQUIRED_DOCUMENTS, STEP_HREF, stepBody, valuesFrom, type SellValues } from './rules';

const KYC_FILE = { category: 'KYC_DOCUMENT', visibility: 'PRIVATE_OWNER' } as const;
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

const INFO_MARK = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4M12 8h.01" />
  </svg>
);

/** The three slots, in the order the reference lists them, each with the name a reviewer will know it by. */
const SLOTS: { docType: MerchantDocumentType; region: string; upload: string }[] = [
  { docType: 'CAC_CERTIFICATE', region: 'CAC certificate', upload: 'Upload CAC certificate' },
  {
    docType: 'STATUS_REPORT',
    region: 'CAC status report or memorandum',
    upload: 'Upload CAC status report or memorandum',
  },
  { docType: 'DIRECTOR_ID', region: 'Proprietor or director ID', upload: 'Upload proprietor or director ID' },
];

/**
 * SO3 (T-121): "Business Verification". Unlike the reference, the CAC number and the three documents are required:
 * submit is refused without them, so the person is not offered a skip. The three documents are a KYC file each, kept
 * private to the owner the way VF1's ID is.
 */
export function SellVerifyBusiness(): React.JSX.Element {
  const application = useMyMerchantApplication();

  if (application.isPending) {
    return (
      <SellFrame title="Verification" step={3} backHref={STEP_HREF.category} action={null}>
        <Loading label="Loading your application" lines={4} />
      </SellFrame>
    );
  }
  if (application.data === undefined) {
    return (
      <SellFrame title="Verification" step={3} backHref={STEP_HREF.category} action={null}>
        <LoadProblem what="your application" onRetry={() => void application.refetch()} />
      </SellFrame>
    );
  }
  return <VerifyForm application={application.data} />;
}

function VerifyForm({ application }: { application: MerchantApplication | null }): React.JSX.Element {
  const router = useRouter();
  const client = useApiClient();
  const save = useSaveMerchantDraft();
  const [values, setValues] = useState<SellValues>(valuesFrom(application));
  const [fileIds, setFileIds] = useState<Partial<Record<MerchantDocumentType, string | null>>>(() =>
    Object.fromEntries((application?.documents ?? []).map((document) => [document.docType, document.fileId])),
  );
  const [uploading, setUploading] = useState<MerchantDocumentType | null>(null);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const attachedIds = (docType: MerchantDocumentType): string | null => fileIds[docType] ?? null;
  const documentsReady = REQUIRED_DOCUMENTS.every((docType) => attachedIds(docType) !== null);
  const ready = values.cacRcNumber.trim() !== '' && documentsReady && uploading === null && !save.isPending;

  const add = async (docType: MerchantDocumentType, files: File[]) => {
    const file = files[0];
    if (file === undefined) return;
    setProblem(undefined);
    setUploading(docType);
    try {
      const fileId = await uploadFile(client, file, KYC_FILE);
      setFileIds((current) => ({ ...current, [docType]: fileId }));
    } catch (error) {
      setProblem(
        error instanceof UploadError && error.reason === 'TOO_LARGE'
          ? 'That file is too large. Choose a smaller one.'
          : 'That file didn’t upload. Check your connection and try again.',
      );
    } finally {
      setUploading(null);
    }
  };

  const next = () => {
    if (!ready) return;
    setProblem(undefined);
    const documents = REQUIRED_DOCUMENTS.flatMap((docType) => {
      const fileId = attachedIds(docType);
      return fileId === null ? [] : [{ docType, fileId }];
    });
    save.mutate(
      { ...stepBody('verify-business', values), documents },
      {
        onSuccess: () => router.push(STEP_HREF.payout),
        onError: () =>
          setProblem('Couldn’t save your verification details. Check your connection and try again.'),
      },
    );
  };

  return (
    <SellFrame
      title="Verification"
      step={3}
      backHref={STEP_HREF.category}
      action={
        <>
          {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
          <Button type="button" disabled={!ready} onClick={next}>
            {save.isPending ? 'Saving…' : 'Continue to payout account'}
          </Button>
        </>
      }
    >
      <TextField
        label="CAC registration number"
        placeholder="RC 1487XXX"
        autoComplete="off"
        mono
        value={values.cacRcNumber}
        onChange={(event) => setValues((current) => ({ ...current, cacRcNumber: event.target.value }))}
      />
      <SectionLabel>Proof of registration</SectionLabel>
      {SLOTS.map((slot) => {
        const attached = attachedIds(slot.docType);
        const media: MediaItem[] =
          attached === null ? [] : [{ id: slot.docType, kind: 'photo', alt: slot.region }];
        return (
          <section key={slot.docType} aria-label={slot.region}>
            <FileDropzone
              label={slot.upload}
              hint={uploading === slot.docType ? 'Uploading…' : 'PDF, JPG, PNG or WebP'}
              media={media}
              requiredCount={0}
              slots={2}
              accept={ACCEPT}
              onAdd={(files) => void add(slot.docType, files)}
            />
          </section>
        );
      })}
      <Banner tone="info" icon={INFO_MARK}>
        All three are required before you can send your application. A person checks them before any Verified
        Merchant badge is given.
      </Banner>
    </SellFrame>
  );
}
