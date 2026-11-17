# SP-M33 — Display & accessibility (T-204)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 7929 — Supporting · Account & settings
- **Built:** http://localhost:3146/account/display
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 7,624 of 224,400 (3.40%)
- **Side by side:** `SP-M33.png` (reference · built · heat map) — **heat map:** `SP-M33.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The built screen sits in `AppShell` under Account (shot with `--content main`), so the reference's own top bar and sticky footer are replaced by `ScreenHeader` and in-flow actions above the real tab bar. The shot ran against `next dev` and a canned stand-in for the platform routes (one proxy adds the sealed session cookie), so names, references and dates are illustrative. The naira sign and fonts are as the harness README describes.

**Real differences (intended, and why)**

- **Text size is three radio cards**, not a row that opens another screen: three choices need no second screen. It is applied with CSS `zoom` on the body (supported by every current browser; Firefox from 126).
- **Nothing here is stored by the platform.** These are preferences of a device, kept in this browser (`komtru.display`) and put on `<html>` as attributes by `DisplayPrefsApplier`, mounted in the root layout so they hold on every page. A banner says so. So there is no loading, empty, error or offline state to draw; a storage that refuses (private mode) still changes the current visit.
- **Bold text** makes everything that states no weight of its own heavier. **Higher contrast** darkens `--slate`, `--trust-gray` and `--border-hairline`. **Reduce motion** is applied on top of the existing `motion-reduce` handling.
- **Low-data mode** reads "Video waits until you play it, photos load as you scroll to them, on any network", not the reference's "Smaller images, no autoplay video". The platform has no smaller-image variant to ask for and the app autoplays nothing; what it can do is load less, and that is wired into the file tiles (`FileTile`): `preload="none"` on video, `loading="lazy"` on photos. Those are the only images and video the app loads.
- **Download photos on Wi-Fi only** holds a photo behind a "Load <photo>" button on mobile data. It works only where the browser says the connection is cellular (the Network Information API: Chrome on Android); anywhere else it does nothing, and the row says so rather than imply otherwise.
- Held by `test/display-screen.test.tsx`, `test/display-prefs.test.ts` and `test/media-low-data.test.tsx`, each screen state with an axe pass.
- The saved preferences are applied by a small inline script in `<head>` (`bootDisplayPrefs`, stringified from the same module) **before first paint**, so large text, high contrast and reduced motion are there from the first frame of every page and not after hydration. `<html>` carries `suppressHydrationWarning` for it. A test runs the script as source text against `applyPrefs` on good, hostile and missing values so the two cannot drift.
