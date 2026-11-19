// The fixtures, checked against the contracts the apps parse. Run at startup, so a stand-in that has
// drifted from `@komtru/shared-types` refuses to serve instead of serving a shape the app will reject.
import { tradeListItemSchema, viewerFactsSchema } from '@komtru/shared-types';

import { tradesFor, viewerFactsFor } from './fixtures.ts';
import { PERSONA_IDS, SCENARIO_IDS } from './personas.ts';

/** Throws with every drifted fixture named, not just the first. */
export function checkFixtures(): void {
  const failures: string[] = [];
  for (const persona of PERSONA_IDS) {
    const facts = viewerFactsSchema.safeParse(viewerFactsFor(persona));
    if (!facts.success) failures.push(`viewer facts for ${persona}: ${facts.error.message}`);
    for (const scenario of SCENARIO_IDS) {
      tradesFor(persona, scenario).forEach((trade, index) => {
        const parsed = tradeListItemSchema.safeParse(trade);
        if (!parsed.success) {
          failures.push(`trade ${index} for ${persona}/${scenario}: ${parsed.error.message}`);
        }
      });
    }
  }
  if (failures.length > 0) {
    throw new Error(`Stand-in fixtures no longer match @komtru/shared-types:\n${failures.join('\n')}`);
  }
}
