// Merchant applications and certification (M5 §3.2, T-055) — the ONLY public surface of this module.
//
// What other modules get: the schema they read, the events they react to, and the status vocabulary.
// The listings half of M5 (T-056) is deferred out of the MVP and is not here.
export * from './infrastructure/postgres/schema/index.js';
export * from './domain/events.js';
export {
  LIVE_STATUSES,
  MERCHANT_APPLICATION_STATUSES,
  isLive,
  type MerchantApplicationStatus,
} from './domain/status.js';
export {
  BUSINESS_TYPES,
  DOCUMENT_TYPES,
  FORM_FIELDS,
  type BusinessType,
  type ChangeItem,
  type DocumentType,
} from './domain/application.js';
