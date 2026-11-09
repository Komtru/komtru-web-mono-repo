// What fulfilment needs from modules that do not exist yet, as ports, in the style of ports.ts.
// Kept apart from TradeDeps so T-061's fixtures did not change; the production module builds one of
// these from TradeDeps plus the two seams below.
import type { Db } from '../../../db/index.js';
import type { Tx } from '../../../platform/events/publish.js';
import type { EnabledCompany } from '../domain/fulfilment.js';
import type { TradeDeps } from './ports.js';

export interface FulfilmentDeps {
  db: Db;
  cities: TradeDeps['cities'];
  proofFiles: TradeDeps['proofFiles'];
  standards: TradeDeps['standards'];
  /** Every `ENABLED` logistics company, Park's default row included (the builder pins and splits it). */
  logistics: { enabledCompanies(tx: Tx): Promise<EnabledCompany[]> };
  /** Design §7.8: which of these cities Park serves today. */
  park: { serviceableCityIds(tx: Tx, cityIds: readonly string[]): Promise<ReadonlySet<string>> };
  now: () => Date;
}

/**
 * SEAM(T-085, T-087). The logistics schema does not exist, so there are no companies to offer. T-087
 * replaces this with a read of `logistics_companies WHERE status = 'ENABLED'` through its barrel; the
 * ship step then lists them with no further change here.
 */
export const noLogisticsCompanies: FulfilmentDeps['logistics'] = {
  enabledCompanies: () => Promise.resolve([]),
};

/**
 * SEAM(T-093). Park's coverage service does not exist, so no city is serviceable and the ship step
 * reports Park as unavailable, with the reason. That is the truth today, not a placeholder answer:
 * nothing can be dropped at a hub that is not built. T-093 replaces this with its cached coverage
 * lookup (hub ACTIVE and OPEN with an ACTIVE agent holding can_receive and can_release).
 */
export const noParkCoverage: FulfilmentDeps['park'] = {
  serviceableCityIds: () => Promise.resolve(new Set<string>()),
};
