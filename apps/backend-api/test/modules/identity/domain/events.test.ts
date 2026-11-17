import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  identityDeviceSignedInEvent,
  identityEmailVerifiedEvent,
  identityLoginFailedEvent,
  identityOtpRequestedEvent,
  identityPartyInvitationClaimedEvent,
  identityPartyInvitationCreatedEvent,
  identityPartyInvitationExpiredEvent,
  identityStaffInvitationAcceptedEvent,
  identityStaffInvitationCancelledEvent,
  identityStaffInvitationCreatedEvent,
  identityPartyLookupPerformedEvent,
  identityPasswordChangedEvent,
  identityPhoneChangeCodeRequestedEvent,
  identityPhoneChangedEvent,
  identityPhoneVerifiedEvent,
  identityUserRegisteredEvent,
  identityUserStatusChangedEvent,
  identityVerificationLevelChangedEvent,
} from '../../../../src/modules/identity/domain/events.js';
import { CATALOGUE } from '../../../../src/modules/notify/domain/catalogue.js';

describe("identity's account events (M1 §11)", () => {
  it('names every event this ticket publishes', () => {
    expect(
      [
        identityUserRegisteredEvent,
        identityOtpRequestedEvent,
        identityEmailVerifiedEvent,
        identityPhoneVerifiedEvent,
        identityLoginFailedEvent,
        identityPasswordChangedEvent,
        identityDeviceSignedInEvent,
        identityUserStatusChangedEvent,
        identityVerificationLevelChangedEvent,
      ].map((e) => e.eventType),
    ).toEqual([
      'identity.user.registered',
      'identity.otp.requested',
      'identity.email.verified',
      'identity.phone.verified',
      'identity.login.failed',
      'identity.password.changed',
      'identity.device.signed_in',
      'identity.user.status_changed',
      'identity.user.verification_level_changed',
    ]);
  });

  it('matches the event names the seeded notification mappings already carry', () => {
    // CATALOGUE.mappings is reference data T-045 shipped. A name that disagrees with it is a
    // security notification that silently never sends.
    const mapped = new Set(CATALOGUE.mappings.map((m) => m.eventName));
    for (const event of [
      identityOtpRequestedEvent,
      identityDeviceSignedInEvent,
      identityPasswordChangedEvent,
    ]) {
      expect(mapped).toContain(event.eventType);
    }
  });

  it('carries no identifier on identity.login.failed — only its hash (S12)', () => {
    // The schema asks for a hash and strips anything else, so a caller that passes the raw
    // identifier cannot put an email address into the outbox by accident.
    const parsed = identityLoginFailedEvent.payload.parse({
      identifierHash: 'ab12',
      identifierKind: 'EMAIL',
      identifier: 'jane@example.com',
      ip: null,
      reason: 'wrong_password',
    });
    expect(Object.keys(parsed).sort()).toEqual(['identifierHash', 'identifierKind', 'ip', 'reason']);
  });

  it('allows a null userId on an OTP request, for the decoy a forgot-password probe creates', () => {
    expect(() =>
      identityOtpRequestedEvent.payload.parse({
        userId: null,
        challengeId: randomUUID(),
        purpose: 'PASSWORD_RESET',
        channels: ['SMS'],
        code: '482913',
        expiresInMinutes: 5,
      }),
    ).not.toThrow();
  });

  it('refuses an OTP request with no channel to deliver on', () => {
    expect(() =>
      identityOtpRequestedEvent.payload.parse({
        userId: randomUUID(),
        challengeId: randomUUID(),
        purpose: 'REGISTRATION',
        channels: [],
        code: '482913',
        expiresInMinutes: 5,
      }),
    ).toThrow();
  });

  it('carries the variables the seeded templates render', () => {
    // identity.otp.requested renders {{code}}, {{purpose}} and {{expiresInMinutes}}; the binding
    // turns `purpose` into copy, so the payload must carry the raw purpose and the minutes.
    const payload = identityOtpRequestedEvent.payload.parse({
      userId: randomUUID(),
      challengeId: randomUUID(),
      purpose: 'REGISTRATION',
      channels: ['SMS'],
      code: '482913',
      expiresInMinutes: 5,
    });
    expect(payload).toMatchObject({ code: '482913', expiresInMinutes: 5, purpose: 'REGISTRATION' });

    const signIn = identityDeviceSignedInEvent.payload.parse({
      userId: randomUUID(),
      deviceId: null,
      deviceLabel: 'Chrome on Android',
      location: 'an unrecognised location',
      signedInAt: new Date().toISOString(),
      ip: null,
    });
    expect(signIn).toMatchObject({ deviceLabel: 'Chrome on Android' });
  });

  it('is version 1 everywhere, since nothing consumes an earlier shape', () => {
    for (const event of [identityUserRegisteredEvent, identityOtpRequestedEvent]) {
      expect(event.version).toBe(1);
    }
  });
});

describe('T-038 staff invitation events', () => {
  it('names the three events at version 1', () => {
    expect(
      [
        identityStaffInvitationCreatedEvent,
        identityStaffInvitationAcceptedEvent,
        identityStaffInvitationCancelledEvent,
      ].map((event) => [event.eventType, event.version]),
    ).toEqual([
      ['identity.staff_invitation.created', 1],
      ['identity.staff_invitation.accepted', 1],
      ['identity.staff_invitation.cancelled', 1],
    ]);
  });

  it('refuses to carry a token or an address', () => {
    const base = {
      invitationId: randomUUID(),
      invitedBy: randomUUID(),
      roleCode: 'SUPPORT_AGENT',
      maskedDestination: 'j••••@example.com',
      expiresAt: new Date().toISOString(),
    };
    expect(identityStaffInvitationCreatedEvent.payload.safeParse(base).success).toBe(true);
    expect(
      identityStaffInvitationCreatedEvent.payload.safeParse({ ...base, email: 'jane@example.com' }).success,
    ).toBe(false);
    expect(identityStaffInvitationCreatedEvent.payload.safeParse({ ...base, token: 'x' }).success).toBe(
      false,
    );
  });
});

describe('T-035 party events (M1 §11)', () => {
  it('names the four events M1 §11 lists, all at version 1', () => {
    expect(
      [
        identityPartyLookupPerformedEvent,
        identityPartyInvitationCreatedEvent,
        identityPartyInvitationClaimedEvent,
        identityPartyInvitationExpiredEvent,
      ].map((event) => [event.eventType, event.version]),
    ).toEqual([
      ['identity.party.lookup_performed', 1],
      ['identity.party_invitation.created', 1],
      ['identity.party_invitation.claimed', 1],
      ['identity.party_invitation.expired', 1],
    ]);
  });

  it('carries the velocity signal §8.3 control 6 asks for, on a miss as well as a hit', () => {
    const payload = identityPartyLookupPerformedEvent.payload.parse({
      actorUserId: randomUUID(),
      channel: 'EMAIL',
      found: false,
      subjectHash: 'a'.repeat(64),
    });
    expect(payload).toMatchObject({ channel: 'EMAIL', found: false });
  });

  it('refuses to carry the address that was looked up (§S12)', () => {
    const base = { actorUserId: randomUUID(), channel: 'EMAIL', found: true, subjectHash: 'a'.repeat(64) };
    expect(
      identityPartyLookupPerformedEvent.payload.safeParse({ ...base, email: 'jane@example.com' }).success,
    ).toBe(false);
    expect(
      identityPartyLookupPerformedEvent.payload.safeParse({ ...base, subject: 'jane@example.com' }).success,
    ).toBe(false);
  });

  it('refuses to carry a recoverable destination or the claim token on the created event', () => {
    const base = {
      invitationId: randomUUID(),
      inviterUserId: randomUUID(),
      channel: 'EMAIL',
      maskedDestination: 'j•••@example.com',
      intendedRole: 'BUYER',
      contextType: 'TRADE',
      contextId: randomUUID(),
      expiresAt: new Date().toISOString(),
    };
    expect(identityPartyInvitationCreatedEvent.payload.safeParse(base).success).toBe(true);
    expect(identityPartyInvitationCreatedEvent.payload.safeParse({ ...base, token: 'x' }).success).toBe(
      false,
    );
    expect(
      identityPartyInvitationCreatedEvent.payload.safeParse({ ...base, destination: 'jane@example.com' })
        .success,
    ).toBe(false);
  });

  it('gives M7 the trade context on claimed and expired, so it can bind or cancel', () => {
    const contextId = randomUUID();
    const claimed = identityPartyInvitationClaimedEvent.payload.parse({
      invitationId: randomUUID(),
      inviterUserId: randomUUID(),
      claimedByUserId: randomUUID(),
      intendedRole: 'SELLER',
      contextType: 'TRADE',
      contextId,
    });
    expect(claimed).toMatchObject({ contextType: 'TRADE', contextId, intendedRole: 'SELLER' });

    const expired = identityPartyInvitationExpiredEvent.payload.parse({
      invitationId: randomUUID(),
      inviterUserId: randomUUID(),
      intendedRole: 'BUYER',
      contextType: null,
      contextId: null,
    });
    expect(expired).toMatchObject({ contextType: null, contextId: null });
  });

  it('lets registration record the invitation it was opened from', () => {
    const invitationId = randomUUID();
    expect(
      identityUserRegisteredEvent.payload.parse({
        userId: randomUUID(),
        publicId: 'KMT-U-7F3K9Q',
        registeredVia: 'register:EMAIL',
        channel: 'EMAIL',
        invitationId,
      }),
    ).toMatchObject({ invitationId });
  });
});

describe("identity's phone change events (F-045)", () => {
  it('are named so the notify mappings can find them', () => {
    const mapped = new Set(CATALOGUE.mappings.map((m) => m.eventName));
    for (const event of [identityPhoneChangeCodeRequestedEvent, identityPhoneChangedEvent]) {
      expect(mapped).toContain(event.eventType);
    }
  });

  it('carry no phone number: the notice has only the masked new one', () => {
    const payload = identityPhoneChangedEvent.payload.parse({
      userId: randomUUID(),
      newPhoneMasked: '+23490•••2290',
      changedAt: new Date().toISOString(),
    });
    expect(JSON.stringify(payload)).not.toMatch(/\+234\d{9}/);
  });
});
