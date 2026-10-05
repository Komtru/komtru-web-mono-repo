// A notification template and how it renders (M11 D5).
//
// Deliberately the dumbest substitution that works: `{{name}}` and nothing else. No conditionals,
// no loops, no partials, no HTML escaping — a template is plain text, and every cleverer feature is
// copy authoring, which M17 owns. The one thing this is strict about is a missing variable: a
// message that reaches a user reading "Your code is {{code}}" is worse than one that never arrives,
// because the second is visible in the delivery record and the first is not.
import { notificationCategorySchema, notificationChannelSchema } from '@komtru/shared-types';
import { z } from 'zod';

/** `identity.otp.requested`: the module that owns the event, then what happened. */
const TEMPLATE_KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const PLACEHOLDER = /\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g;

export const templateSchema = z
  .object({
    templateKey: z.string().regex(TEMPLATE_KEY),
    channel: notificationChannelSchema,
    category: notificationCategorySchema,
    locale: z.string().min(2).default('en-NG'),
    version: z.number().int().min(1).default(1),
    subject: z.string().min(1).optional(),
    body: z.string().min(1),
    /** Declared, not inferred, so the integrity check has two statements to compare. */
    variables: z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/)).default([]),
    /** M11 D2. Bypasses preferences and per-user caps; never true outside a security message. */
    isSecurityCritical: z.boolean().default(false),
  })
  .check((ctx) => {
    const { channel, subject } = ctx.value;
    if (channel === 'EMAIL' && subject === undefined) {
      ctx.issues.push({
        code: 'custom',
        input: subject,
        message: 'EMAIL needs a subject',
        path: ['subject'],
      });
    }
    if (channel !== 'EMAIL' && subject !== undefined) {
      ctx.issues.push({
        code: 'custom',
        input: subject,
        message: `${channel} has nowhere to put a subject`,
        path: ['subject'],
      });
    }
  });

export type NotificationTemplate = z.output<typeof templateSchema>;

export const mappingSchema = z.object({
  eventName: z.string().min(1),
  templateKey: z.string().regex(TEMPLATE_KEY),
  enabled: z.boolean().default(true),
});
export type NotificationMapping = z.output<typeof mappingSchema>;

/** Every `{{name}}` in the subject and then the body, deduplicated, in the order they appear. */
export function placeholders(body: string, subject?: string): string[] {
  const found = new Set<string>();
  for (const text of [subject ?? '', body]) {
    for (const [, name] of text.matchAll(PLACEHOLDER)) if (name !== undefined) found.add(name);
  }
  return [...found];
}

/** A template asked for a variable the caller did not supply. Never a provider's fault. */
export class TemplateRenderError extends Error {
  constructor(
    readonly templateKey: string,
    readonly variable: string,
  ) {
    super(`notify: template '${templateKey}' needs a value for '${variable}'`);
    this.name = 'TemplateRenderError';
  }
}

export interface RenderedTemplate {
  subject?: string;
  body: string;
}

export function renderTemplate(
  template: NotificationTemplate,
  variables: Record<string, string>,
): RenderedTemplate {
  // One pass with a callback: a substituted value is never re-scanned, so a user-supplied name of
  // `{{code}}` cannot pull another variable's value into the message.
  const substitute = (text: string) =>
    text.replace(PLACEHOLDER, (_match, name: string) => {
      const value = variables[name];
      if (value === undefined) throw new TemplateRenderError(template.templateKey, name);
      return value;
    });

  const { subject } = template;
  return {
    ...(subject === undefined ? {} : { subject: substitute(subject) }),
    body: substitute(template.body),
  };
}
