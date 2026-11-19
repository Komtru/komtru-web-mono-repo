// `POST /v1/webhooks/youverify`. Authenticated by Youverify's signature over the raw bytes, never by
// a session: this is the only trustworthy channel for a liveness verdict, because the browser SDK's
// `onSuccess` callback takes no payload and anyone can call it from a console.
import { rawBody, WEBHOOK_PATH_PREFIX } from '../../../platform/http/raw-body.js';
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import { recordWebhook, type RecordWebhookDeps } from '../services/webhookIngest.service.js';
import { YOUVERIFY_SIGNATURE_HEADER } from '../infrastructure/providers/youverify.signature.js';
import { webhookAckSchema } from './validations.js';

export const YOUVERIFY_WEBHOOK_PATH = '/webhooks/youverify';

// The raw-body capture is scoped by this prefix; a path outside it would have no bytes to verify,
// and the failure would be a 400 on every delivery against a provider that retries.
if (!`/v1${YOUVERIFY_WEBHOOK_PATH}/`.startsWith(WEBHOOK_PATH_PREFIX)) {
  throw new Error('trust: the Youverify webhook must be mounted under the raw-body prefix');
}

export function youverifyWebhookRoutes(deps: () => RecordWebhookDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'post',
      path: YOUVERIFY_WEBHOOK_PATH,
      scope: 'PUBLIC',
      summary: 'Youverify webhook receiver',
      // A replay is harmless by construction: the dedup index absorbs it.
      retryable: false,
      // Per IP and generous. Youverify retries in bursts from a small set of addresses, so this only
      // bounds somebody hammering the endpoint with bodies that fail the signature check — which are
      // stored, so the bound is also what keeps that table from being a place to write.
      rateLimit: { points: 600, durationSeconds: 60, by: ['ip'] },
      schema: { response: webhookAckSchema },
      handler: async (ctx) => {
        await recordWebhook(deps(), rawBody(ctx.req), ctx.req.get(YOUVERIFY_SIGNATURE_HEADER));
        // Always 200, whatever the outcome. An unsigned or unreadable delivery is recorded and
        // refused, not retried: telling Youverify to send it again cannot make it valid.
        return { received: true as const };
      },
    }),
  ];
}
