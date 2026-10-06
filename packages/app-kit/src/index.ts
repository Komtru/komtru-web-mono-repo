// @komtru/app-kit: the pieces every Komtru Next app composes.
//
// This entry point is isomorphic — it runs in a React Server Component, in middleware, in a route
// handler and in the browser. Anything that needs Next, React or a server lives behind its own
// entry, the way `@komtru/api-client` splits its own:
//
//   @komtru/app-kit/next     middleware and the /api/auth/* route handlers
//   @komtru/app-kit/react    the Query, api-client and realtime providers
//   @komtru/app-kit/sentry   error tracking
//   @komtru/app-kit/ui       the error and not-found screens
//   @komtru/app-kit/styles.css  the app's global stylesheet
export * from './config.js';
