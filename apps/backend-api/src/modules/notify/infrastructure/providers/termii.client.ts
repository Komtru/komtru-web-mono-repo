// Termii SMS. Network code, so this file may be imported only from notify/jobs/.
//
// The base URL is required rather than defaulted: Termii's host differs per account region, it is
// already in the environment (TERMII_BASE_URL), and a hard-coded default is how a send ends up
// going somewhere nobody configured.
import { providerRequest } from '../../../../platform/providers/http.js';
import type { Logger } from '../../../../platform/logger.js';
import type { ProviderSendResult } from './mailjet.client.js';

export interface SendSmsOptions {
  baseUrl: string;
  apiKey: string;
  /** The registered sender id. An unregistered one is rejected, not silently replaced. */
  senderId: string;
  /** E.164, as identity stores it. */
  to: string;
  text: string;
}

interface TermiiResponse {
  message_id?: string;
  message?: string;
}

export async function sendSms(logger: Logger, options: SendSmsOptions): Promise<ProviderSendResult> {
  const response = await providerRequest<TermiiResponse>(logger, {
    provider: 'termii',
    operation: 'sms.send',
    method: 'POST',
    url: `${options.baseUrl.replace(/\/$/, '')}/api/sms/send`,
    body: {
      to: options.to,
      from: options.senderId,
      sms: options.text,
      type: 'plain',
      channel: 'generic',
      // Termii takes the key in the body, not a header. providerRequest never logs a body.
      api_key: options.apiKey,
    },
    idempotent: false,
  });

  return { providerReference: response.body.message_id };
}
