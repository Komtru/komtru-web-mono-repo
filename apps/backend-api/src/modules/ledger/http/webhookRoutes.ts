// `POST /webhooks/paystack` (m8 §8). Authenticated by Paystack's signature over the raw bytes, not
// by a session: the signature is checked before anything is stored (M8 §11), the delivery goes into
// the dedup log, a job is queued, and Paystack gets its 200 without waiting on a provider call or a
// ledger write.
import { rawBody, WEBHOOK_PATH_PREFIX } from '../../../platform/http/raw-body.js';
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import { recordWebhook, type RecordWebhookDeps } from '../services/webhookIngest.service.js';
import { webhookAckSchema } from './payment.validation.js';

export const PAYSTACK_WEBHOOK_PATH = '/webhooks/paystack';
export const PAYSTACK_SIGNATURE_HEADER = 'x-paystack-signature';

// The raw-body capture is scoped by this prefix; a path outside it would have no bytes to verify.
if (!`/v1${PAYSTACK_WEBHOOK_PATH}/`.startsWith(WEBHOOK_PATH_PREFIX)) {
  throw new Error('ledger: the Paystack webhook must be mounted under the raw-body prefix');
}

export function webhookRoutes(deps: () => RecordWebhookDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'post',
      path: PAYSTACK_WEBHOOK_PATH,
      scope: 'PUBLIC',
      summary: 'Paystack webhook receiver',
      // A replay is harmless by construction: the dedup index absorbs it.
      retryable: false,
      // Per IP, and generous: Paystack sends from a handful of addresses and retries in bursts, so
      // this only bounds someone hammering the endpoint with bodies that fail the signature check.
      rateLimit: { points: 600, durationSeconds: 60, by: ['ip'] },
      schema: { response: webhookAckSchema },
      handler: async (ctx) => {
        await recordWebhook(deps(), rawBody(ctx.req), ctx.req.get(PAYSTACK_SIGNATURE_HEADER));
        return { received: true as const };
      },
    }),
  ];
}
