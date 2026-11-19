# web-site

The public marketing site: **komtru.com**. What Komtru is, for people who do not have an account.

It is a separate Next app from `web-app-ui`, and deliberately so. It holds no session, installs no
service worker, and calls one unauthenticated backend route. Routing the marketing pages through
the product app would mean adding every one of them to that app's public-path list, running the
session gate on each, and redeploying the PWA to fix a typo in a headline.

## Where things are

|                |                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------- |
| `app/`         | one directory per route; `page.tsx` is the home page                                      |
| `app/site.css` | the design reference's stylesheet, ported, with its palette replaced by the shared tokens |
| `src/chrome/`  | the header, footer, FAQ band and closing CTA, rendered on every page                      |
| `src/home/`    | the home page's own sections                                                              |
| `src/art/`     | the reference's illustrations and icons, carried across as inline SVG                     |
| `src/site/`    | the nav map, the FAQ copy, the environment, and the waitlist call                         |

## Environment

Everything is `NEXT_PUBLIC_*`; the site has no secrets because it holds no session.

|                               |                                                                                                                                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_KOMTRU_APP_URL`  | where the consumer app lives. Every "Log in" and "Start a trade" button points here. **Unset, they point at `/waitlist` instead** — the honest answer before the app is open, and better than a host that does not resolve. |
| `NEXT_PUBLIC_KOMTRU_API_URL`  | the backend, for `POST /v1/waitlist`. Unset, the form says the waitlist is not open rather than appearing to succeed.                                                                                                       |
| `NEXT_PUBLIC_KOMTRU_SITE_URL` | this site's own origin, for canonical URLs and the QR code that points at `/waitlist`.                                                                                                                                      |

The backend's `ALLOWED_ORIGINS` must name this site's origin, or the browser blocks the waitlist
post before it is sent. Locally that is `http://localhost:3005`, which `pnpm env:backend` writes.

## What is not here yet

Thirteen of the seventeen routes render a placeholder: the header and footer link to every page
from the first deploy, because a navigation bar where six of seven links 404 reads as a broken site
rather than an early one. Each answers 200 and says plainly that the page is being written.

The design reference also carries an interactive player that steps through 65 app-screen mockups,
inside a CSS phone. That is ~500KB of generated markup behind 275KB of its own CSS, and it is not
here. The hero's single screen is hand-ported instead (`src/home/FindATradeScreen.tsx`), in this
site's own tokens.

## Porting notes

The reference is one 1.9MB HTML file, hash-routed. Three things changed on the way in, each for a
reason worth knowing:

1. **Real routes, not `#/buyers`.** A hash route is one document swapping its contents, which costs
   every page its own URL, title and place in a search index — most of the point of a marketing site.
2. **The palette is gone.** The reference opened with its own `:root` block. Every value in it was
   already a token in `@komtru/config/tailwind/preset.css` under a longer name, so each rule names
   the token and the two cannot drift.
3. **The city photos are four images.** They arrived as one 8000×2595 sprite behind
   `background-position` percentages, inlined as a 1.3MB data URI. Four files are 300KB and can be
   sized and lazy-loaded.

One trap, written down because it cost an hour: **do not use `ring` as a class name here.** Tailwind
generates a `ring` utility, and a bare `ring` in the markup paints a 1px box-shadow square around
whatever carries it. The reference had no Tailwind and so had no reason to avoid the name.
