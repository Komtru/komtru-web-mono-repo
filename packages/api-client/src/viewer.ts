// Who the app shell is being drawn for (F-037). Mirrors the backend's `GET /me/viewer`. The web app's auth
// route reads it with a fresh access token on every sign-in and refresh and seals the answer into the
// session hint, which is the only thing a page render can see.
import { viewerFactsSchema } from '@komtru/shared-types';
import { defineEndpoint } from './contracts.js';

export { viewerFactsSchema };
export type { ViewerFacts } from '@komtru/shared-types';

export const getViewerFacts = defineEndpoint({
  method: 'get',
  path: '/me/viewer',
  scope: 'CONSUMER',
  schema: { response: viewerFactsSchema },
});
