// What the merchant module needs from other modules, as narrow questions rather than imports: the
// services below never name `files`, `geo`, `config`, `ledger` or the queue. `module.ts` is the only file
// that binds these to the real barrels, so a service is testable with a stub and a module boundary is a
// list of six functions.

export interface FileFacts {
  id: string;
  uploaderUserId: string;
  category: string;
  /** `ACTIVE` or `TOMBSTONED`. */
  status: string;
  /** `PENDING`, `READY` or `REJECTED`. */
  uploadState: string;
  contentType: string;
}

export interface PayoutAccountFacts {
  id: string;
  status: string;
  bankName: string | null;
  accountNumberMasked: string;
  accountName: string | null;
  /** T-051's verdict as T-073 stored it on the account, or null when no name-match has run. */
  nameMatchResult: string | null;
}

export interface LocationLabel {
  stateName: string;
  cityName: string;
}

export interface SignedDocument {
  url: string;
  expiresAt: Date | null;
  contentType: string;
}

export interface StaffViewer {
  userId: string;
  roles: readonly string[];
}

export interface EvidenceJob {
  applicationId: string;
  /** 0 on the first run, counting up as the job reschedules itself while the CAC lookup is pending. */
  attempt: number;
}

export interface MerchantPorts {
  findFile(fileId: string): Promise<FileFacts | undefined>;
  /** Idempotent. Grants the roles that may decide an application a read of one KYC document. */
  grantReviewerAccess(fileId: string): Promise<void>;
  /** True when the city exists, is active, and belongs to the state. */
  cityBelongsToState(stateId: string, cityId: string): Promise<boolean>;
  locationLabel(cityId: string): Promise<LocationLabel | undefined>;
  /** The trade category codes a merchant may sell in, which decide the Trade Standards that apply. */
  categoryCodes(): Promise<string[]>;
  payoutAccountOf(userId: string, payoutAccountId: string): Promise<PayoutAccountFacts | undefined>;
  /**
   * M20's one authorised path from a file id to bytes: it decides access and, for a KYC document,
   * writes `file_access_log`. Returns undefined when the file cannot be served (removed, refused).
   */
  signDocument(fileId: string, viewer: StaffViewer): Promise<SignedDocument | undefined>;
  /** Asks trust for the CAC lookup. An ordinary refusal is an outcome, never a throw. */
  requestCacLookup(input: { userId: string; rcNumber: string }): Promise<{ outcome: string }>;
  /** After commit, allowed to fail: the application is already submitted. */
  enqueueEvidence(job: EvidenceJob, delayMs?: number): Promise<void>;
}
