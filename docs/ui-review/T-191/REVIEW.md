# T-191 review (2026-11-06) — fix pass pending

A fresh reviewer read the branch at its fourth commit. `web-app-ui` tests (100) and ui-kit
`test/shells` (251) pass, and no security defect was found. **The build manager hands this file
to the fixer.**

## Owner ruling (2026-11-06): Buy/Sell switch on mobile

**Y2 / mobile Buy/Sell.** In v2, Y2 is an older mobile Role Switcher list, and the mobile frames
show no Buy/Sell control. The owner ruled to render the same
`ModeSwitch` in the mobile LogoBar, so mobile users can change mode exactly as on desktop. A
certified merchant stays locked to Sell. Record the ruling in the ticket.

## Must fix

1. **Mobile has no mode switch.** Render `ModeSwitch` in the mobile LogoBar (default above). Do
   the hand visual comparison for DX-03, DX-04, TX-02 and DX-37 in `README.md`, or record DX-37
   as skipped with the reason.
2. **The root redirect is stale.** `apps/web-app-ui/src/app-config.ts:13` has
   `homePath: '/trades'`. Redirect the root to `landingFor(mode)`, which is `/home` for Buy and
   `/shop` for Sell. Fix the app-config test and the comment in `app/page.tsx`.
3. **The certified-merchant lock exists only in the chrome.** Add a TODO naming T-111: buyer
   routes must be rejected on the server when `canActAsBuyer === false`, and the cookie is a view
   preference only. Add `nav.test.ts` cases showing that a certified viewer gets the Sell tabs
   and the Sell landing whatever the cookie says.

## Should fix

4. **`ModeSwitch` semantics.** Make it a two-option segmented control: `role="group"` plus two
   buttons with `aria-pressed`. When locked, use `aria-disabled` with a description of why.
5. **Collapse button.** Give it a constant name and let `aria-expanded` carry the state. Update
   the test.
6. **Collapse state resets on every navigation.** Persist it (a cookie read on the server, or
   `localStorage` inside try/catch) or move `AppShell` into a route-group `layout.tsx`. Add a test.
7. **Trade Code search goes to a 404.** Route a Trade Code to `/trades?code=…` until the
   workspace route exists. Add hostile-input tests for `searchDestination`: `//evil.com`,
   `https://x`, `KMT-1/../x`, `KMT-1?x`, `kmt-9`, spaces and `%`.
8. **Middleware tests.** Add `/home`, `/orders`, `/listings` and `/shop`, and a negative
   assertion that `/explore` is now gated. Note in the README that v1 never shipped, so dropping
   `/explore` needs no redirect.
9. **Mode cookie.** Add `secure` outside localhost and `SameSite=Lax`.
10. **`GlobalSearch`.** Give the landmark a distinct name ("Site search") and set
    `aria-hidden` on the "press /" hint.
11. **Missing tests:**
    - the `/` shortcut focuses the field, and is ignored while typing or with a modifier key;
    - switching from Sell to Buy pushes `/home`;
    - focus stays on the button after collapse;
    - each duplicated `actions` copy sits inside a hidden ancestor.
12. **Small items:**
    - remove the stray blank import line in `ResponsiveAppShell.tsx`;
    - `docs/tickets/13-web-app-ui.md:26` still says Explore;
    - add a follow-up ticket, T-222, "Re-base TabBar to v2 mobile styling" (MVP, depends on T-191,
      model sonnet), in `docs/tickets/18-ui-master-v2.md`, and add it to the MVP list in
      `docs/MVP.md`.

## Accepted deviations

- `.role-toggle` has no CSS in v2, so `ModeSwitch` is drawn from existing tokens.
- The profile control shows a person glyph instead of initials.
- Alerts moved from a tab to the bell.
- The new routes are placeholders.
- The tablet bar has no search, because TX-02 has none.
- OF1 is unchanged.
