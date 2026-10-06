import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../../../../src/modules/notify/domain/catalogue.js';
import { BINDINGS, allowsUnverifiedDestination } from '../../../../src/modules/notify/domain/binding.js';

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
  it('binds the four identity events the catalogue already has templates for', () => {
    expect(BINDINGS.map((b) => b.event.eventType).sort()).toEqual([
      'identity.device.signed_in',
      'identity.otp.requested',
      'identity.password.changed',
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
      'identity.session.reuse_detected': {
        userId: randomUUID(),
        familyId: randomUUID(),
        replayedSessionId: randomUUID(),
        scope: 'CONSUMER',
        ip: null,
        revokedSessions: 3,
      },
    };

    for (const binding of BINDINGS) {
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
