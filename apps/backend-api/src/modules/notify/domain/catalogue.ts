// The content this build ships (M11 D5).
//
// WHERE TEMPLATES LIVE, and why it is two places: the database is what a send renders from, so ops
// can ship a copy change as a new row without a deploy; this file is the default content, synced
// into the database at boot and never stamped over an existing row (services/sync.service.ts). A
// copy change here is therefore a NEW `version`, which is also what `PUT
// /admin/notification-templates/:key` will do.
//
// Everything here is parsed by zod at module load, so a malformed template cannot be imported at
// all, and checked by assertCatalogueIntegrity() before the module starts, so a template that asks
// for a variable no binding supplies stops the process at boot rather than at 2am.
//
// Every later module ticket adds its own templates and mappings to this file.
import { TRADE_NOTIFICATION_PLANS } from '../../trades/index.js';
import { tradeTemplates } from './tradeCatalogue.js';
import { mappingSchema, placeholders, templateSchema } from './template.js';
import type { NotificationMapping, NotificationTemplate } from './template.js';

export interface NotificationCatalogue {
  templates: NotificationTemplate[];
  mappings: NotificationMapping[];
}

/**
 * M1's four security notifications (ticket T-045). All `SECURITY` and all security-critical: a user
 * cannot opt out of being told their password changed, and a cap must never swallow an OTP.
 *
 * The mappings name the events T-031 and T-034 will publish. They are inert until a binding exists
 * (domain/binding.ts), which is the point: the copy is reviewable now, and the identity ticket adds
 * only the code that pulls a recipient and the variables out of its own payload.
 */
const IDENTITY_TEMPLATES: unknown[] = [
  {
    templateKey: 'identity.otp.requested',
    channel: 'SMS',
    category: 'SECURITY',
    body: 'Komtru: {{code}} is your {{purpose}} code. It expires in {{expiresInMinutes}} minutes. Never share it.',
    variables: ['code', 'purpose', 'expiresInMinutes'],
    isSecurityCritical: true,
  },
  {
    templateKey: 'identity.otp.requested',
    channel: 'EMAIL',
    category: 'SECURITY',
    subject: 'Your Komtru {{purpose}} code',
    body: '{{code}} is your Komtru {{purpose}} code. It expires in {{expiresInMinutes}} minutes.\n\nIf you did not ask for this code, change your password and contact support.',
    variables: ['code', 'purpose', 'expiresInMinutes'],
    isSecurityCritical: true,
  },
  {
    templateKey: 'identity.device.new_sign_in',
    channel: 'EMAIL',
    category: 'SECURITY',
    subject: 'New sign-in to your Komtru account',
    body: 'Your Komtru account was signed in on {{deviceLabel}} from {{location}} at {{signedInAt}}.\n\nIf this was not you, sign out of every device from Security settings and change your password now.',
    variables: ['deviceLabel', 'location', 'signedInAt'],
    isSecurityCritical: true,
  },
  {
    templateKey: 'identity.device.new_sign_in',
    channel: 'PUSH',
    category: 'SECURITY',
    body: 'New sign-in on {{deviceLabel}} from {{location}}. Not you? Secure your account now.',
    variables: ['deviceLabel', 'location'],
    isSecurityCritical: true,
  },
  {
    templateKey: 'identity.device.new_sign_in',
    channel: 'IN_APP',
    category: 'SECURITY',
    body: 'New sign-in on {{deviceLabel}} from {{location}} at {{signedInAt}}.',
    variables: ['deviceLabel', 'location', 'signedInAt'],
    isSecurityCritical: true,
  },
  {
    templateKey: 'identity.password.changed',
    channel: 'EMAIL',
    category: 'SECURITY',
    subject: 'Your Komtru password was changed',
    body: 'Your Komtru password was changed at {{changedAt}}.\n\nIf this was not you, contact support immediately: whoever changed it can now sign in as you.',
    variables: ['changedAt'],
    isSecurityCritical: true,
  },
  {
    templateKey: 'identity.password.changed',
    channel: 'PUSH',
    category: 'SECURITY',
    body: 'Your Komtru password was changed at {{changedAt}}. Not you? Contact support.',
    variables: ['changedAt'],
    isSecurityCritical: true,
  },
  {
    templateKey: 'identity.password.changed',
    channel: 'IN_APP',
    category: 'SECURITY',
    body: 'Your password was changed at {{changedAt}}.',
    variables: ['changedAt'],
    isSecurityCritical: true,
  },
  {
    templateKey: 'identity.session.reuse_detected',
    channel: 'SMS',
    category: 'SECURITY',
    body: 'Komtru: we signed you out everywhere at {{detectedAt}} after suspicious activity. Sign in again to continue.',
    variables: ['detectedAt'],
    isSecurityCritical: true,
  },
  {
    templateKey: 'identity.session.reuse_detected',
    channel: 'EMAIL',
    category: 'SECURITY',
    subject: 'We signed you out of Komtru for your security',
    body: 'We detected a sign-in token being reused at {{detectedAt}}, which usually means it was stolen, so we ended every session on your account.\n\nSign in again, and change your password if you did not recognise the last sign-in.',
    variables: ['detectedAt'],
    isSecurityCritical: true,
  },
  {
    templateKey: 'identity.session.reuse_detected',
    channel: 'IN_APP',
    category: 'SECURITY',
    body: 'Every session was ended at {{detectedAt}} after a sign-in token was reused.',
    variables: ['detectedAt'],
    isSecurityCritical: true,
  },
];

const IDENTITY_MAPPINGS: unknown[] = [
  { eventName: 'identity.otp.requested', templateKey: 'identity.otp.requested' },
  { eventName: 'identity.device.signed_in', templateKey: 'identity.device.new_sign_in' },
  { eventName: 'identity.password.changed', templateKey: 'identity.password.changed' },
  { eventName: 'identity.session.reuse_detected', templateKey: 'identity.session.reuse_detected' },
];

/**
 * T-046: the outcome of a "My city isn't listed" request. One template, because the three outcomes
 * (added, merged into an existing city, rejected) differ only in the sentence the binding renders
 * into `outcomeLine`: a template has no conditionals (M11 D5). An ACCOUNT notification, so a user can
 * opt out of it; nothing about it is security critical.
 */
const GEO_TEMPLATES: unknown[] = [
  {
    templateKey: 'geo.city_request.decided',
    channel: 'IN_APP',
    category: 'ACCOUNT',
    body: 'Your request for {{requestedName}} in {{stateName}}: {{outcomeLine}}',
    variables: ['requestedName', 'stateName', 'outcomeLine'],
  },
  {
    templateKey: 'geo.city_request.decided',
    channel: 'EMAIL',
    category: 'ACCOUNT',
    subject: 'An update on your Komtru city request',
    body: 'You asked us to add {{requestedName}} in {{stateName}}.\n\n{{outcomeLine}}',
    variables: ['requestedName', 'stateName', 'outcomeLine'],
  },
];

const GEO_MAPPINGS: unknown[] = [
  { eventName: 'geo.city_request.decided', templateKey: 'geo.city_request.decided' },
];

/**
 * T-068: every trade notification. The copy is in `tradeCatalogue.ts`; the mappings come from the
 * trades module's plans, which are what say which event sends which key.
 */
const TRADE_MAPPINGS: unknown[] = TRADE_NOTIFICATION_PLANS.map((plan) => ({
  eventName: plan.event.eventType,
  templateKey: plan.templateKey,
}));

export const CATALOGUE: NotificationCatalogue = {
  templates: [...IDENTITY_TEMPLATES, ...GEO_TEMPLATES, ...tradeTemplates()].map((t) =>
    templateSchema.parse(t),
  ),
  mappings: [...IDENTITY_MAPPINGS, ...GEO_MAPPINGS, ...TRADE_MAPPINGS].map((m) => mappingSchema.parse(m)),
};

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value) => b.includes(value));

/**
 * Throws ONE error naming every problem, so a boot failure is fixed in one pass rather than five
 * restarts. Called by the module's start() before anything is synced or subscribed.
 */
export function assertCatalogueIntegrity(catalogue: NotificationCatalogue, defaultLocale: string): void {
  const problems: string[] = [];
  const seen = new Set<string>();
  const keys = new Set(catalogue.templates.map((t) => t.templateKey));
  const keysInDefaultLocale = new Set(
    catalogue.templates.filter((t) => t.locale === defaultLocale).map((t) => t.templateKey),
  );

  for (const template of catalogue.templates) {
    const label = `${template.templateKey} (${template.channel}, ${template.locale} v${template.version})`;
    const identity = `${template.templateKey}|${template.channel}|${template.locale}|${template.version}`;
    if (seen.has(identity)) problems.push(`${label}: duplicate template`);
    seen.add(identity);

    const used = placeholders(template.body, template.subject);
    if (!sameSet(used, template.variables)) {
      problems.push(
        `${label}: body uses [${used.join(', ')}] but declares [${template.variables.join(', ')}]`,
      );
    }
    if (template.category === 'SECURITY' && !template.isSecurityCritical) {
      problems.push(`${label}: a SECURITY template must be security critical (M11 D2)`);
    }
  }

  for (const key of keys) {
    if (!keysInDefaultLocale.has(key)) {
      problems.push(`${key}: no template in the default locale '${defaultLocale}'`);
    }
  }

  for (const mapping of catalogue.mappings) {
    if (!keys.has(mapping.templateKey)) {
      problems.push(`${mapping.eventName} -> ${mapping.templateKey}: no template with that key`);
    }
  }

  if (problems.length) {
    throw new Error(
      `notify: the template catalogue has ${problems.length} problem(s):\n  ${problems.join('\n  ')}`,
    );
  }
}
