import { describe, expect, it } from 'vitest';
import * as sharedTypes from '../src/index.js';

describe('@komtru/shared-types public surface', () => {
  it('exports every schema and helper from one entry point', () => {
    for (const name of [
      'koboSchema',
      'positiveKoboSchema',
      'formatNaira',
      'nairaToKobo',
      'applyBps',
      'cursorPageRequestSchema',
      'pageRequestSchema',
      'paginatedSchema',
      'pagedSchema',
      'problemDetailsSchema',
      'problemTypeUri',
      'isProblemDetails',
      'eventEnvelopeSchema',
      'eventTypeSchema',
      'defineEvent',
      'queueDeadLetteredEvent',
      'uuidSchema',
      'publicUserIdSchema',
      'tradeCodeSchema',
      'hubCodeSchema',
      'normaliseCityName',
      'citySchema',
      'sessionScopeSchema',
      'currencySchema',
      'sellerKindSchema',
      'feeScheduleSchema',
      'parseFeeSchedule',
      'FeeScheduleError',
      'computeTradeFees',
      'snapshotFees',
      'snapshotParkCashFee',
      'feeSnapshotSchema',
    ]) {
      expect(sharedTypes, name).toHaveProperty(name);
    }
  });

  it('no longer exports the scaffold placeholder', () => {
    expect(sharedTypes).not.toHaveProperty('workspace');
  });
});
