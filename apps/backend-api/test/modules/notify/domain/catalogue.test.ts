import { describe, expect, it } from 'vitest';
import {
  CATALOGUE,
  assertCatalogueIntegrity,
  type NotificationCatalogue,
} from '../../../../src/modules/notify/domain/catalogue.js';
import { templateSchema } from '../../../../src/modules/notify/domain/template.js';

const catalogue = (overrides: Partial<NotificationCatalogue> = {}): NotificationCatalogue => ({
  templates: [
    templateSchema.parse({
      templateKey: 'test.thing',
      channel: 'SMS',
      category: 'ACCOUNT',
      body: 'hello {{name}}',
      variables: ['name'],
    }),
  ],
  mappings: [{ eventName: 'test.thing.happened', templateKey: 'test.thing', enabled: true }],
  ...overrides,
});

describe('CATALOGUE', () => {
  it('passes its own integrity check', () => {
    expect(() => assertCatalogueIntegrity(CATALOGUE, 'en-NG')).not.toThrow();
  });

  it('seeds the identity templates', () => {
    const identity = CATALOGUE.templates.filter((t) => t.templateKey.startsWith('identity.'));
    expect(new Set(identity.map((t) => t.templateKey))).toEqual(
      new Set([
        'identity.otp.requested',
        'identity.device.new_sign_in',
        'identity.password.changed',
        'identity.session.reuse_detected',
        'identity.phone_change.code',
        'identity.phone.changed',
      ]),
    );
  });

  it('marks every seeded identity template security critical', () => {
    const identity = CATALOGUE.templates.filter((t) => t.templateKey.startsWith('identity.'));
    expect(identity.every((t) => t.isSecurityCritical && t.category === 'SECURITY')).toBe(true);
  });

  it('keeps every SMS body inside one segment', () => {
    const long = CATALOGUE.templates.filter((t) => t.channel === 'SMS' && t.body.length > 160);
    expect(long.map((t) => t.templateKey)).toEqual([]);
  });

  it('maps every seeded template to an event', () => {
    const mapped = new Set(CATALOGUE.mappings.map((m) => m.templateKey));
    expect(CATALOGUE.templates.every((t) => mapped.has(t.templateKey))).toBe(true);
  });
});

describe('assertCatalogueIntegrity', () => {
  it('accepts a well-formed catalogue', () => {
    expect(() => assertCatalogueIntegrity(catalogue(), 'en-NG')).not.toThrow();
  });

  it('names a template whose body uses a variable it does not declare', () => {
    const bad = catalogue({
      templates: [
        templateSchema.parse({
          templateKey: 'test.thing',
          channel: 'SMS',
          category: 'ACCOUNT',
          body: 'hello {{name}}',
          variables: [],
        }),
      ],
    });
    expect(() => assertCatalogueIntegrity(bad, 'en-NG')).toThrow(/test\.thing.*name/s);
  });

  it('names a template that declares a variable its body never uses', () => {
    const bad = catalogue({
      templates: [
        templateSchema.parse({
          templateKey: 'test.thing',
          channel: 'SMS',
          category: 'ACCOUNT',
          body: 'hello',
          variables: ['name'],
        }),
      ],
    });
    expect(() => assertCatalogueIntegrity(bad, 'en-NG')).toThrow(/test\.thing.*name/s);
  });

  it('names a mapping with no template', () => {
    const bad = catalogue({
      mappings: [{ eventName: 'test.other.happened', templateKey: 'test.missing', enabled: true }],
    });
    expect(() => assertCatalogueIntegrity(bad, 'en-NG')).toThrow(/test\.missing/);
  });

  it('names a template key with nothing in the default locale', () => {
    expect(() => assertCatalogueIntegrity(catalogue(), 'fr-FR')).toThrow(/fr-FR/);
  });

  it('refuses a SECURITY template that is not security critical', () => {
    const bad = catalogue({
      templates: [
        templateSchema.parse({
          templateKey: 'test.thing',
          channel: 'SMS',
          category: 'SECURITY',
          body: 'hello {{name}}',
          variables: ['name'],
          isSecurityCritical: false,
        }),
      ],
    });
    expect(() => assertCatalogueIntegrity(bad, 'en-NG')).toThrow(/security critical/i);
  });

  it('refuses a duplicate key, channel, locale and version', () => {
    const one = catalogue().templates[0];
    if (!one) throw new Error('fixture');
    expect(() => assertCatalogueIntegrity(catalogue({ templates: [one, one] }), 'en-NG')).toThrow(
      /duplicate/i,
    );
  });

  it('lists every problem at once, so one boot failure is fixed in one pass', () => {
    const bad = catalogue({
      mappings: [
        { eventName: 'a.b.c', templateKey: 'missing.one', enabled: true },
        { eventName: 'a.b.d', templateKey: 'missing.two', enabled: true },
      ],
    });
    const message = String(expectThrow(() => assertCatalogueIntegrity(bad, 'en-NG')));
    expect(message).toContain('missing.one');
    expect(message).toContain('missing.two');
  });
});

const expectThrow = (fn: () => void): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
};
