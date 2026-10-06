import { describe, expect, it } from 'vitest';
import {
  TemplateRenderError,
  placeholders,
  renderTemplate,
  templateSchema,
  type NotificationTemplate,
} from '../../../../src/modules/notify/domain/template.js';

const template = (overrides: Partial<NotificationTemplate> = {}): NotificationTemplate =>
  templateSchema.parse({
    templateKey: 'test.thing',
    channel: 'SMS',
    category: 'ACCOUNT',
    locale: 'en-NG',
    version: 1,
    body: 'hello',
    variables: [],
    isSecurityCritical: false,
    ...overrides,
  });

describe('placeholders', () => {
  it('finds every {{name}} in the subject and the body, once each', () => {
    expect(placeholders('{{a}} and {{b}} and {{a}}', 'about {{c}}')).toEqual(['c', 'a', 'b']);
  });

  it('ignores a lone brace pair', () => {
    expect(placeholders('{ a } {{}}')).toEqual([]);
  });
});

describe('templateSchema', () => {
  it('requires a subject on EMAIL', () => {
    expect(templateSchema.safeParse({ ...raw(), channel: 'EMAIL' }).success).toBe(false);
  });

  it('refuses a subject on every other channel', () => {
    expect(templateSchema.safeParse({ ...raw(), channel: 'SMS', subject: 'hi' }).success).toBe(false);
  });

  it('refuses a template key that is not module-dotted', () => {
    expect(templateSchema.safeParse({ ...raw(), templateKey: 'Thing' }).success).toBe(false);
  });
});

describe('renderTemplate', () => {
  it('substitutes every placeholder', () => {
    const result = renderTemplate(template({ body: 'Your code is {{code}}', variables: ['code'] }), {
      code: '123456',
    });
    expect(result).toEqual({ body: 'Your code is 123456' });
  });

  it('substitutes repeated placeholders and the subject too', () => {
    const result = renderTemplate(
      template({
        channel: 'EMAIL',
        subject: 'Hello {{name}}',
        body: '{{name}}, {{name}}',
        variables: ['name'],
      }),
      { name: 'Ada' },
    );
    expect(result).toEqual({ subject: 'Hello Ada', body: 'Ada, Ada' });
  });

  it('names the template and the variable when one is missing', () => {
    expect(() =>
      renderTemplate(
        template({ templateKey: 'identity.otp.requested', body: '{{code}}', variables: ['code'] }),
        {},
      ),
    ).toThrow(/identity\.otp\.requested.*code/);
  });

  it('throws a TemplateRenderError, so a caller can tell it from a provider failure', () => {
    expect(() => renderTemplate(template({ body: '{{x}}', variables: ['x'] }), {})).toThrow(
      TemplateRenderError,
    );
  });

  it('ignores a variable the template never asked for', () => {
    expect(renderTemplate(template({ body: 'hello' }), { unused: 'x' })).toEqual({ body: 'hello' });
  });

  it('does not re-scan a substituted value for placeholders', () => {
    const result = renderTemplate(template({ body: '{{a}}', variables: ['a'] }), { a: '{{b}}' });
    expect(result.body).toBe('{{b}}');
  });
});

const raw = () => ({
  templateKey: 'test.thing',
  channel: 'SMS' as const,
  category: 'ACCOUNT' as const,
  body: 'hello',
});
