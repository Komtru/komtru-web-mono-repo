// Paths the console serves without a STAFF session.
//
// `/sign-in` is always open (`createKomtruMiddleware` adds it). The rest are the doors a person
// walks through *before* they have a staff session, and each exists because staff sign-in itself
// needs a second factor that has to be set up first:
//
//   /welcome          OP-28: accept the invitation and set up two-step sign-in. Signed in as the
//                     consumer account the invitation is for, never as staff.
//   /invite           the link in the invitation email; it only forwards to /welcome.
//   /api/invitation   the one route handler that signs that consumer account in.
//
// `/api/auth` is open inside the middleware itself: the handlers there are how a session is got.
export const PUBLIC_PATHS = ['/welcome', '/invite', '/api/invitation'] as const;
