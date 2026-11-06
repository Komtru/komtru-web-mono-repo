// See `src/auth/invitation-sign-in.ts` for what this is and why it sets no cookie.
//
// Built on the first request, not at module scope: `next build` evaluates every route module, and a
// config read up here would be a read on the machine that builds the app.
import { readAppConfig } from '@komtru/app-kit';
import { appSpec } from '../../../../src/app-config';
import { createInvitationSignIn } from '../../../../src/auth/invitation-sign-in';

let handler: ReturnType<typeof createInvitationSignIn> | undefined;

export const POST = (request: Request): Promise<Response> =>
  (handler ??= createInvitationSignIn({ config: readAppConfig(appSpec, process.env) }))(request);

/** Per request; nothing here may be cached. */
export const dynamic = 'force-dynamic';
