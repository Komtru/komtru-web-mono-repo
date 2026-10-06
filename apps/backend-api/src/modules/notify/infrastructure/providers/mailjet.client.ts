// Mailjet Send API v3.1. Network code, so this file may be imported only from notify/jobs/
// (komtru/provider-clients).
//
// Credentials are arguments, never a config read: the decision of WHETHER to send — dry run,
// sandbox, a missing credential — belongs to the job, so that it is visible in one place and
// testable without a provider.
import { providerRequest } from '../../../../platform/providers/http.js';
import type { Logger } from '../../../../platform/logger.js';

export const MAILJET_BASE_URL = 'https://api.mailjet.com';

export interface SendEmailOptions {
  baseUrl?: string;
  apiKey: string;
  apiSecret: string;
  fromEmail: string;
  fromName: string;
  /** Mailjet validates the request and delivers nothing. True for every non-production run. */
  sandbox: boolean;
  to: string;
  subject: string;
  text: string;
}

interface MailjetResponse {
  Messages?: { Status?: string; Errors?: unknown; To?: { MessageID?: number | string }[] }[];
}

/** The provider's own id for the message, for support questions and for a delivery webhook later. */
export interface ProviderSendResult {
  providerReference: string | undefined;
}

export async function sendEmail(logger: Logger, options: SendEmailOptions): Promise<ProviderSendResult> {
  const { baseUrl = MAILJET_BASE_URL, apiKey, apiSecret, sandbox } = options;
  const response = await providerRequest<MailjetResponse>(logger, {
    provider: 'mailjet',
    operation: 'send',
    method: 'POST',
    url: `${baseUrl}/v3.1/send`,
    headers: {
      authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
    },
    body: {
      ...(sandbox ? { SandboxMode: true } : {}),
      Messages: [
        {
          From: { Email: options.fromEmail, Name: options.fromName },
          To: [{ Email: options.to }],
          Subject: options.subject,
          TextPart: options.text,
        },
      ],
    },
    // Not idempotent: a repeat inside one attempt would be a second email. The queue's backoff and
    // the notification's claim are the only retry a send gets.
    idempotent: false,
  });

  const message = response.body.Messages?.[0];
  // Mailjet answers 200 for a message it refused; the per-message Status is the real answer.
  if (message?.Status !== 'success') {
    throw new Error(`mailjet: message not accepted (status '${String(message?.Status)}')`);
  }
  const id = message.To?.[0]?.MessageID;
  return { providerReference: id === undefined ? undefined : String(id) };
}
