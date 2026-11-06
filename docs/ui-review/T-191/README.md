# T-191 review: shell rework against the v2 master

The automated visual check still targets the v1 file, so it was not run. This records what was compared by hand against `docs/design-reference/Komtru — UI Living Master v2.html` (line numbers are that file's).

## Compared

| Built                                                                            | v2 reference                                                                                                                                                           |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop sidebar, Buy: Home, Trades, Messages, Discover, Account, plus Collapse   | DX-03, line 8148 (`dweb-sidebar`, `dweb-collapse`)                                                                                                                     |
| Desktop sidebar, Sell: Shop, Orders, Listings, Messages, Account                 | DX-04, line 8170                                                                                                                                                       |
| Desktop top bar: search with "press / to search", Buy/Sell switch, bell, profile | DX-03, line 8148 (`search-box`, `role-toggle`, `tb-icon`, avatar)                                                                                                      |
| Tablet top nav: five items, switch, bell, profile at the right                   | TX-02, line 8698 (`tweb-topnav`). TX-02 has no search field, so the tablet bar has none either                                                                         |
| Mobile tab bar: Home, Trades, Messages, Discover, Account                        | `komtru-mobile-nav`, line 7481 (the Y2 frame) and the other mobile frames (for example 2656). Discover links to `/browse`                                              |
| Buy/Sell switch                                                                  | Y2 (line 7459) is the older mobile "Role Switcher" list (Buyer view, Merchant Shop, Park Agent Terminal). The switch that DX-03, DX-04 and TX-02 draw is the one built |

## Deviations

- **Mobile tab bar styling.** The five items now match v2. The v2 `.komtru-mobile-nav` also draws an indigo-soft pill behind the active item, 20px icons, 10px labels and a blur and shadow. `TabBar` still draws T-110's v1 styling (indigo text, 19px icons, 9px labels), because `TabBar` is parity-tested against the v1 stylesheet. Restyling it belongs with a ticket that re-bases those parity tests on v2.
- **`.role-toggle` has no CSS in v2.** The markup is in DX-03, DX-04 and TX-02 but the stylesheet has no rule for it. `ModeSwitch` draws a pill from existing tokens: indigo-soft for Buy, emerald-soft for Sell, with a knob on the right in Sell.
- **Y2 is not built as a screen.** The v2 Y2 frame is an older mobile list of three views (Buyer, Merchant Shop, Park Agent Terminal). Owner ruling 2026-11-06: mobile gets the same Buy/Sell `ModeSwitch` as desktop and tablet, rendered in the mobile header (`LogoBar`), not Y2's role list. A certified merchant stays locked to Sell. The mobile frames draw no switch, so there is no reference to compare it against.
- **Sell mode on mobile.** The mobile frames only draw the Buy tab bar. Sell mode uses the same five items as DX-04 at every width.
- **Avatar.** v2 shows initials ("AO"). The shell has no name for the viewer until T-111, so the profile control shows the person glyph and links to Account.
- **Alerts** left the nav and is the bell, as in v2. `/alerts` still exists as a route.
- **Routes.** v2's `/home`, `/browse`, `/orders` and `/listings` are placeholders until T-207 and T-209. `/explore` became `/browse`.
- **A certified merchant** is held in Sell mode and the switch is locked (design 6.3). v2 does not draw this case.
- **OF1** is unchanged and stays in Buy mode (it is a static page and does not read the mode cookie).

## Fix pass (2026-11-06)

Hand comparison for the four screens the review named, from small slices at the `SCREEN_INDEX.md` lines:

| Screen                            | Result                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DX-03 Home, Buyer (line 8145)     | Desktop frame with `dweb-sidebar` beside the content. Matches the built five Buy destinations, the Collapse control and the bar tools. The content (trade rows, quick actions) is T-207's.                                                                                                                       |
| DX-04 Home, Merchant (8167)       | Same chrome as DX-03 with the Sell destinations. Matches. The shop KPI strip is T-207's.                                                                                                                                                                                                                         |
| TX-02 Home, Buyer (8695)          | `tweb-topnav` lists Home, Trades, Messages, Discover, Account, then `role-toggle` ("Buy") and a `tb-icon`. Matches the built tablet bar, which has no search either.                                                                                                                                             |
| DX-37 Account and security (8575) | **Skipped, with the reason.** Its sidebar is an Account sub-navigation (Personal info, Verification, Security, Notifications, Payout account) beside a settings page, which is T-210's screen. The built Account rail is D9's (it also lists Trust history and Park Agent) and is not part of this shell rework. |

- **`/explore` is gone with no redirect.** v1 never shipped, so no user holds an `/explore` link. The middleware test asserts it is now gated like any unknown path.
- **Trade Code search** goes to `/trades?code=KMT-n` until the trade workspace route exists (T-116). Any other input, including `//evil.com`, `https://x`, `KMT-1/../x`, `KMT-1?x`, spaces and `%`, is an encoded `/browse?q=` value.
- **Collapse state** is kept in `localStorage` (inside try/catch), so each screen's fresh shell keeps the rail narrow. It is read after mount, so a narrowed rail paints expanded for one frame.
- **Collapse control name** is constant ("Collapse navigation"), and `aria-expanded` carries the state.
- **Server-side lock.** The certified-merchant lock is chrome only; a TODO naming T-111 is in `nav.ts` (`rootDestination`): buyer routes must be rejected on the server when `canActAsBuyer === false`.
