// T-068's notify half: every trade plan has copy, a mapping and a binding, and the variables its
// audience supplies are exactly the ones its template declares. A mismatch here would otherwise be a
// dead-lettered notification at the moment a trade changes hands.
import { describe, expect, it } from 'vitest';
import { BINDINGS } from '../../../../src/modules/notify/domain/binding.js';
import { assertCatalogueIntegrity, CATALOGUE } from '../../../../src/modules/notify/domain/catalogue.js';
import { renderTemplate } from '../../../../src/modules/notify/domain/template.js';
import {
  T093_SEAMS,
  TRADE_NOTIFICATION_PLANS,
  audienceFor,
  tradeDeepLink,
} from '../../../../src/modules/trades/infrastructure/notifications.js';
import { code, now, parties, samplePayload } from '../../trades/notification-samples.js';

// `₦` is not a word character, so a `\\b` beside it never matches; the words get boundaries, the symbol does not.
const findSensitive = (text: string): string | null =>
  /₦|\b(pin|address|ngn|naira|reason)\b/i.exec(text)?.[0] ?? null;

const templatesFor = (key: string) => CATALOGUE.templates.filter((t) => t.templateKey === key);

describe('trade notification catalogue', () => {
  it('passes the boot integrity check', () => {
    expect(() => assertCatalogueIntegrity(CATALOGUE, 'en-NG')).not.toThrow();
  });

  it('has a binding, a mapping and templates for every plan', () => {
    for (const plan of TRADE_NOTIFICATION_PLANS) {
      expect(templatesFor(plan.templateKey).length, plan.templateKey).toBeGreaterThanOrEqual(2);
      expect(
        CATALOGUE.mappings.some(
          (m) => m.eventName === plan.event.eventType && m.templateKey === plan.templateKey,
        ),
        plan.templateKey,
      ).toBe(true);
      const binding = BINDINGS.find((b) => b.subscriber === plan.subscriber);
      expect(binding, plan.subscriber).toBeDefined();
      expect(binding?.event.eventType).toBe(plan.event.eventType);
      expect(binding?.templateKey).toBe(plan.templateKey);
      expect(binding?.audience).toBeTypeOf('function');
    }
  });

  it('ships no trade template that no plan sends', () => {
    const planned = new Set(TRADE_NOTIFICATION_PLANS.map((p) => p.templateKey));
    const shipped = new Set(
      CATALOGUE.templates.map((t) => t.templateKey).filter((key) => key.startsWith('trades.')),
    );
    expect([...shipped].filter((key) => !planned.has(key))).toEqual([]);
  });

  it('supplies exactly the variables each template declares, and every template renders', () => {
    for (const plan of TRADE_NOTIFICATION_PLANS) {
      const [recipient] = audienceFor(plan, samplePayload(plan), parties);
      expect(recipient, plan.templateKey).toBeDefined();
      for (const template of templatesFor(plan.templateKey)) {
        expect(new Set(Object.keys(recipient!.variables)), `${plan.templateKey} ${template.channel}`).toEqual(
          new Set(template.variables),
        );
        expect(() => renderTemplate(template, recipient!.variables)).not.toThrow();
      }
    }
  });

  it('puts the deep link in every body, IN_APP, PUSH and EMAIL', () => {
    for (const plan of TRADE_NOTIFICATION_PLANS) {
      const [recipient] = audienceFor(plan, samplePayload(plan), parties);
      for (const template of templatesFor(plan.templateKey)) {
        expect(
          renderTemplate(template, recipient!.variables).body,
          `${plan.templateKey} ${template.channel}`,
        ).toContain(tradeDeepLink(code));
      }
    }
  });

  it('uses the TRADE category, never as security-critical, so opt-outs apply', () => {
    for (const plan of TRADE_NOTIFICATION_PLANS) {
      for (const template of templatesFor(plan.templateKey)) {
        expect(template.category).toBe('TRADE');
        expect(template.isSecurityCritical).toBe(false);
      }
    }
  });

  it('keeps sensitive words out of everything a recipient is sent, variables included', () => {
    for (const plan of TRADE_NOTIFICATION_PLANS) {
      const payload = samplePayload(plan);
      // The sample, plus every variant an event can carry that changes the words.
      const variants: unknown[] = [payload];
      if ('decision' in (payload as object)) {
        variants.push(
          { ...(payload as object), decision: 'ACCEPTED', newDueAt: now },
          { ...(payload as object), decision: 'DECLINED' },
        );
      }
      if ('reason' in (payload as object)) {
        for (const reason of ['DELIVERY_OVERDUE', 'SELLER_CANNOT_FULFIL', 'MUTUAL_AGREEMENT']) {
          variants.push({ ...(payload as object), reason });
        }
      }
      if ('refundRequested' in (payload as object)) {
        for (const refundRequested of [true, false]) {
          variants.push({ ...(payload as object), refundRequested });
        }
      }
      for (const variant of variants) {
        for (const recipient of audienceFor(plan, variant, parties)) {
          for (const template of templatesFor(plan.templateKey)) {
            const rendered = renderTemplate(template, recipient.variables);
            const text = `${rendered.subject ?? ''} ${rendered.body}`;
            expect(findSensitive(text), `${plan.templateKey} ${template.channel}: ${text}`).toBeNull();
          }
        }
      }
    }
  });

  it('has a guard that can fail', () => {
    for (const bad of [
      'Pay ₦5,000 now',
      'Amount: NGN 5000',
      'Your PIN is 1234',
      'Ship to the address on file',
      'Declined. Reason: price',
    ]) {
      expect(findSensitive(bad), bad).not.toBeNull();
    }
    expect(
      findSensitive('Trade KMT-7398512-NG was funded. Open the trade: https://app.komtru.com/trades/x'),
    ).toBeNull();
  });

  it('ships nothing for the T-093 seams, so T-093 must add event, copy and plan together', () => {
    for (const seam of T093_SEAMS) {
      expect(templatesFor(seam.templateKey)).toEqual([]);
      expect(CATALOGUE.mappings.filter((m) => m.templateKey === seam.templateKey)).toEqual([]);
    }
  });
});
