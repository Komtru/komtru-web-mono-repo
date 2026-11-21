import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../../../../src/modules/notify/domain/catalogue.js';
import { TRADE_NOTIFICATION_PLANS } from '../../../../src/modules/trades/infrastructure/notifications.js';
import {
  BINDINGS,
  allowsUnverifiedDestination,
  defineAudienceBinding,
  defineBinding,
  phoneTargetFor,
} from '../../../../src/modules/notify/domain/binding.js';

const bindingFor = (eventType: string) => {
  const found = BINDINGS.find((binding) => binding.event.eventType === eventType);
  if (!found) throw new Error(`no binding for ${eventType}`);
  return found;
};

const otp = bindingFor('identity.otp.requested');

const otpPayload = (overrides: Record<string, unknown> = {}) => ({
  userId: randomUUID(),
  challengeId: randomUUID(),
  purpose: 'REGISTRATION',
  channels: ['SMS'],
  code: '482913',
  expiresInMinutes: 5,
  ...overrides,
});

describe("notify's identity bindings", () => {
  it('binds the identity events the catalogue has templates for', () => {
    const identity = BINDINGS.filter((b) => b.event.eventType.startsWith('identity.'));
    expect(identity.map((b) => b.event.eventType).sort()).toEqual([
      'identity.device.signed_in',
      'identity.otp.requested',
      'identity.password.changed',
      'identity.phone.changed',
      'identity.phone_change.code_requested',
      'identity.session.reuse_detected',
    ]);
  });

  it('names each subscriber once, in the notify.on-<event> form the platform expects', () => {
    const names = BINDINGS.map((b) => b.subscriber);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^notify\.on-[a-z-]+$/);
  });

  it('points at a template key the catalogue actually ships', () => {
    const keys = new Set(CATALOGUE.templates.map((t) => t.templateKey));
    for (const binding of BINDINGS) expect(keys).toContain(binding.templateKey);
  });

  it('supplies exactly the variables each bound template declares', () => {
    // The boot check asserts the same thing against the database; this one fails in CI without one.
    const samples: Record<string, unknown> = {
      'identity.otp.requested': otpPayload(),
      'identity.device.signed_in': {
        userId: randomUUID(),
        deviceId: null,
        deviceLabel: 'Chrome on Android',
        location: 'an unrecognised location',
        signedInAt: new Date().toISOString(),
        ip: null,
      },
      'identity.password.changed': {
        userId: randomUUID(),
        viaRecovery: false,
        changedAt: new Date().toISOString(),
        revokedSessions: 2,
      },
      'merchant.application.decided': {
        applicationId: randomUUID(),
        userId: randomUUID(),
        outcome: 'CHANGES_REQUESTED',
        status: 'CHANGES_REQUESTED',
        reason: 'The scan is cut off.',
        requested: [{ kind: 'DOCUMENT', key: 'CAC_CERTIFICATE' }],
        decidedByUserId: randomUUID(),
      },
      'geo.city_request.decided': {
        requestId: randomUUID(),
        requesterUserId: randomUUID(),
        status: 'ADDED',
        stateId: randomUUID(),
        stateName: 'Plateau',
        requestedName: 'Jos East',
        cityId: randomUUID(),
        cityName: 'Jos East',
        reason: null,
      },
      'identity.phone_change.code_requested': {
        userId: randomUUID(),
        challengeId: randomUUID(),
        code: '482913',
        expiresInMinutes: 5,
      },
      'identity.phone.changed': {
        userId: randomUUID(),
        newPhoneMasked: '+23490•••2290',
        changedAt: new Date().toISOString(),
      },
      'identity.session.reuse_detected': {
        userId: randomUUID(),
        familyId: randomUUID(),
        replayedSessionId: randomUUID(),
        scope: 'CONSUMER',
        ip: null,
        revokedSessions: 3,
      },
      'logistics.member.invited': {
        memberId: randomUUID(),
        companyId: randomUUID(),
        companyName: 'Swift Couriers',
        userId: randomUUID(),
        role: 'OPERATOR',
        via: 'INVITATION',
      },
    };

    // Trade bindings resolve their audience from the database; their variables are checked against the
    // catalogue in trade-bindings.test.ts.
    for (const binding of BINDINGS.filter((b) => b.audience === undefined)) {
      const declared = new Set(
        CATALOGUE.templates.filter((t) => t.templateKey === binding.templateKey).flatMap((t) => t.variables),
      );
      const [recipient] = binding.recipients(samples[binding.event.eventType]);
      expect(recipient, `binding ${binding.subscriber}`).toBeDefined();
      expect(new Set(Object.keys(recipient?.variables ?? {})), `binding ${binding.subscriber}`).toEqual(
        declared,
      );
    }
  });

  it('sends an OTP only on the channel the challenge was issued for', () => {
    const [recipient] = otp.recipients(otpPayload({ channels: ['SMS'] }));
    expect(recipient?.channels).toEqual(['SMS']);

    const [emailed] = otp.recipients(otpPayload({ channels: ['EMAIL'] }));
    expect(emailed?.channels).toEqual(['EMAIL']);
  });

  it('mirrors to email when the event asks for both', () => {
    const [recipient] = otp.recipients(otpPayload({ channels: ['SMS', 'EMAIL'] }));
    expect(recipient?.channels).toEqual(['SMS', 'EMAIL']);
  });

  it('turns the raw purpose into the copy the template renders mid-sentence', () => {
    const [recipient] = otp.recipients(otpPayload({ purpose: 'PASSWORD_RESET' }));
    expect(recipient?.variables).toMatchObject({
      code: '482913',
      purpose: 'password reset',
      expiresInMinutes: '5',
    });
  });

  it('notifies nobody for a challenge with no user (the forgot-password decoy)', () => {
    expect(otp.recipients(otpPayload({ userId: null }))).toEqual([]);
  });

  it('lets an OTP reach an address nobody has verified, and nothing else', () => {
    expect(allowsUnverifiedDestination('identity.otp.requested')).toBe(true);
    expect(allowsUnverifiedDestination('identity.password.changed')).toBe(false);
    expect(allowsUnverifiedDestination('identity.device.new_sign_in')).toBe(false);
    expect(allowsUnverifiedDestination('identity.session.reuse_detected')).toBe(false);
  });
});

describe('bindings that look their audience up', () => {
  it('are exactly the trade plans: any other binding must name its recipients from its payload', () => {
    const lookedUp = BINDINGS.filter((b) => b.audience !== undefined).map((b) => b.subscriber);
    expect(lookedUp.sort()).toEqual(TRADE_NOTIFICATION_PLANS.map((p) => p.subscriber).sort());
  });

  it('never also name recipients from the payload', () => {
    for (const binding of BINDINGS.filter((b) => b.audience !== undefined)) {
      expect(binding.recipients({}), binding.subscriber).toEqual([]);
    }
  });

  it('cannot be defined with both, because the subscriber would silently prefer audience', () => {
    const [first] = BINDINGS.filter((b) => b.audience !== undefined);
    expect(() =>
      defineBinding({
        subscriber: 'notify.on-both',
        event: first!.event,
        templateKey: first!.templateKey,
        recipients: () => [{ userId: 'u', variables: {} }],
        audience: () => Promise.resolve([]),
      }),
    ).toThrow(/both recipients and audience/);
    expect(() =>
      defineAudienceBinding({
        subscriber: 'notify.on-audience',
        event: first!.event,
        templateKey: first!.templateKey,
        audience: () => Promise.resolve([]),
      }),
    ).not.toThrow();
  });
});

describe("notify's city-request binding (T-046)", () => {
  const decided = bindingFor('geo.city_request.decided');
  const payload = (overrides: Record<string, unknown> = {}) => ({
    requestId: randomUUID(),
    requesterUserId: randomUUID(),
    status: 'ADDED',
    stateId: randomUUID(),
    stateName: 'Plateau',
    requestedName: 'Jos East',
    cityId: randomUUID(),
    cityName: 'Jos East',
    reason: null,
    ...overrides,
  });

  it('tells the requester, and only the requester', () => {
    const body = payload();
    const recipients = decided.recipients(body);
    expect(recipients.map((r) => r.userId)).toEqual([body.requesterUserId]);
  });

  it('says what happened for each outcome', () => {
    const line = (overrides: Record<string, unknown>) =>
      decided.recipients(payload(overrides))[0]?.variables.outcomeLine;
    expect(line({ status: 'ADDED' })).toContain('is now on Komtru');
    expect(line({ status: 'MERGED', cityName: 'Jos' })).toContain('We already list this place as Jos');
    expect(line({ status: 'REJECTED', cityId: null, cityName: null, reason: 'Not a real place' })).toBe(
      'We could not add it. Not a real place',
    );
  });

  it('is an account notification a user may opt out of, not a security one', () => {
    const templates = CATALOGUE.templates.filter((t) => t.templateKey === 'geo.city_request.decided');
    expect(templates.map((t) => t.channel).sort()).toEqual(['EMAIL', 'IN_APP']);
    expect(templates.every((t) => t.category === 'ACCOUNT' && !t.isSecurityCritical)).toBe(true);
  });
});

describe('which phone a template goes to (F-045, SP-M05)', () => {
  it('sends the new number its code to the number being proven, and the notice to the one just replaced', () => {
    expect(phoneTargetFor('identity.phone_change.code')).toBe('PENDING');
    expect(phoneTargetFor('identity.phone.changed')).toBe('RETIRED');
  });

  it('leaves every other template on the proven number', () => {
    for (const binding of BINDINGS) {
      if (binding.templateKey.startsWith('identity.phone')) continue;
      expect(phoneTargetFor(binding.templateKey), binding.templateKey).toBe('PRIMARY');
    }
  });

  it('never emails the code for the new number, and never sends it anywhere but SMS', () => {
    const [recipient] = bindingFor('identity.phone_change.code_requested').recipients({
      userId: randomUUID(),
      challengeId: randomUUID(),
      code: '482913',
      expiresInMinutes: 5,
    });
    expect(recipient?.channels).toEqual(['SMS']);
  });
});
