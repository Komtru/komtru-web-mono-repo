// The fixtures, checked against the contracts the apps parse. Run at startup, so a stand-in that has drifted
// from `@komtru/shared-types` or `@komtru/api-client` refuses to serve instead of serving a shape the app will
// reject.
import {
  comparisonSchema,
  evidenceItemSchema,
  getFile,
  disputeDetailSchema,
  disputeEvidenceSchema,
  disputeSchema,
  getDeliveryDeadline,
  getInspection,
  getPayoutSummary,
  getShipOptions,
  listPayouts,
  listTradeActivity,
  merchantApplicationSchema,
  meSchema,
  paymentStatusSchema,
  payoutAccountSchema,
  timelineEntrySchema,
  tradeStandardSchema,
  tradeViewSchema,
  verificationStatusSchema,
} from '@komtru/api-client';
import { addressSchema, tradeListItemSchema, viewerFactsSchema } from '@komtru/shared-types';

import {
  addressesFor,
  deliveryDeadlineFor,
  disputeDetailFor,
  disputeEvidenceFor,
  disputesFor,
  disputeTimelineFor,
  evidenceComparisonFor,
  fileFor,
  inspectionFor,
  meFor,
  merchantApplicationFor,
  paymentStatusFor,
  payoutAccountsFor,
  payoutSummaryFor,
  payoutsFor,
  shipOptionsFor,
  tradeActivityFor,
  STANDARD_VERSION_IDS_LIST,
  tradeEvidenceFor,
  tradeFor,
  tradeStandardFor,
  tradesFor,
  verificationStatusFor,
  viewerFactsFor,
} from './fixtures.ts';
import { PERSONA_IDS, SCENARIO_IDS, type PersonaId, type ScenarioId } from './personas.ts';

/** The part of a zod schema this check reads: whether it parsed, and why not. */
interface Checkable {
  safeParse: (value: unknown) => { success: boolean; error?: { message: string } };
}

/** Records a failure, named, when the value does not parse. */
function check(failures: string[], label: string, schema: Checkable, value: unknown): void {
  const parsed = schema.safeParse(value);
  if (!parsed.success) failures.push(`${label}: ${parsed.error?.message ?? 'does not parse'}`);
}

/** Throws with every drifted fixture named, not just the first. */
export function checkFixtures(): void {
  const failures: string[] = [];
  for (const versionId of STANDARD_VERSION_IDS_LIST) {
    check(failures, `trade standard ${versionId}`, tradeStandardSchema, tradeStandardFor(versionId));
  }
  for (const persona of PERSONA_IDS) {
    check(failures, `viewer facts for ${persona}`, viewerFactsSchema, viewerFactsFor(persona));
    for (const scenario of SCENARIO_IDS) {
      const where = `${persona}/${scenario}`;
      tradesFor(persona, scenario).forEach((trade, index) => {
        check(failures, `trade ${index} for ${where}`, tradeListItemSchema, trade);
      });
      // Staff have no consumer account, so no consumer read exists for them to check.
      if (persona === 'staff') continue;
      checkConsumerReads(failures, persona, scenario, where);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Stand-in fixtures no longer match @komtru/shared-types or @komtru/api-client:\n${failures.join('\n')}`,
    );
  }
}

function checkConsumerReads(
  failures: string[],
  persona: Exclude<PersonaId, 'staff'>,
  scenario: ScenarioId,
  where: string,
): void {
  check(failures, `me for ${where}`, meSchema, meFor(persona, scenario));
  check(
    failures,
    `merchant application for ${where}`,
    merchantApplicationSchema.nullable(),
    merchantApplicationFor(persona, scenario),
  );
  for (const trade of tradesFor(persona, scenario)) {
    check(
      failures,
      `trade ${trade.tradeCode} for ${where}`,
      tradeViewSchema,
      tradeFor(persona, scenario, trade.id),
    );
  }
  check(
    failures,
    `verification status for ${where}`,
    verificationStatusSchema,
    verificationStatusFor(persona),
  );
  payoutAccountsFor(persona).forEach((account, index) => {
    check(failures, `payout account ${index} for ${where}`, payoutAccountSchema, account);
  });
  addressesFor(persona).forEach((address, index) => {
    check(failures, `address ${index} for ${where}`, addressSchema, address);
  });
  for (const trade of tradesFor(persona, scenario)) {
    const payment = paymentStatusFor(persona, scenario, trade.id);
    check(failures, `payment status for ${trade.tradeCode} in ${where}`, paymentStatusSchema, payment);
    check(
      failures,
      `inspection for ${trade.tradeCode} in ${where}`,
      getInspection.schema.response,
      inspectionFor(persona, scenario, trade.id),
    );
    // F-069/F-073 deliver & inspect
    check(
      failures,
      `delivery deadline for ${trade.tradeCode} in ${where}`,
      getDeliveryDeadline.schema.response,
      deliveryDeadlineFor(persona, scenario, trade.id),
    );
    for (const item of tradeEvidenceFor(persona, scenario, trade.id, null) ?? []) {
      check(failures, `trade evidence for ${trade.tradeCode} in ${where}`, evidenceItemSchema, item);
    }
  }
  check(failures, 'a file', getFile.schema.response, fileFor('0190b0a0-0000-7000-8000-000000000821'));
  for (const dispute of disputesFor(persona, scenario)) {
    const label = `dispute ${dispute.code} for ${where}`;
    check(failures, label, disputeSchema, dispute);
    check(failures, `${label} detail`, disputeDetailSchema, disputeDetailFor(persona, scenario, dispute.id));
    for (const entry of disputeTimelineFor(persona, scenario, dispute.id) ?? []) {
      check(failures, `${label} timeline`, timelineEntrySchema, entry);
    }
    for (const item of disputeEvidenceFor(persona, scenario, dispute.id) ?? []) {
      check(failures, `${label} evidence`, disputeEvidenceSchema, item);
    }
    check(
      failures,
      `${label} comparison`,
      comparisonSchema,
      evidenceComparisonFor(persona, scenario, dispute.id),
    );
  }
  // F-069/F-073 fulfil & payouts
  check(failures, `payout summary for ${where}`, getPayoutSummary.schema.response, payoutSummaryFor(persona));
  check(failures, `payouts for ${where}`, listPayouts.schema.response, {
    items: payoutsFor(persona),
    nextCursor: null,
  });
  for (const trade of tradesFor(persona, scenario)) {
    // The delivery deadline is checked once, with the deliver & inspect reads above.
    check(
      failures,
      `activity for ${trade.tradeCode} in ${where}`,
      listTradeActivity.schema.response,
      tradeActivityFor(persona, scenario, trade.id),
    );
    const options = shipOptionsFor(persona, scenario, trade.id);
    if (options !== null) {
      check(
        failures,
        `ship options for ${trade.tradeCode} in ${where}`,
        getShipOptions.schema.response,
        options,
      );
    }
  }
}
