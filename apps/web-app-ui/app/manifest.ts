import { KOMTRU_TOKENS } from '@komtru/ui-kit';
import type { MetadataRoute } from 'next';

/**
 * The web app manifest, served at `/manifest.webmanifest` (owner ruling 2026-11-20: the app installs
 * on people's devices). With the service worker `(app)/layout.tsx` registers (`public/sw.js`), this is
 * what makes the browser offer "Install" / "Add to Home Screen".
 *
 * `start_url` is `/` rather than `/home`: the root decides, so someone signed out lands on Welcome and
 * someone signed in on Home. The icons are drawn by `scripts/make-icons.mjs` from the Komtru mark.
 * Middleware never sees any of this: its matcher excludes `.webmanifest`, `.png` and `.svg`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Komtru',
    short_name: 'Komtru',
    description: 'Trade with anyone in Nigeria and get paid, or get your money back.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: KOMTRU_TOKENS['--komtru-midnight'],
    theme_color: KOMTRU_TOKENS['--komtru-midnight'],
    categories: ['finance', 'shopping'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
    shortcuts: [{ name: 'Start a trade', short_name: 'New trade', url: '/trade/new' }],
  };
}
