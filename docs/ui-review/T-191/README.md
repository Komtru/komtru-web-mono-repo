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
- **Y2 is not built as a screen.** The v2 Y2 frame is a mobile list of three views (Buyer, Merchant Shop, Park Agent Terminal) and conflicts with the Buy/Sell switch the ticket describes. The switch on the desktop and tablet bars is built. The mobile frames carry no switch, so mobile has no Buy/Sell control yet and stays in whichever mode the cookie holds. Needs a ruling.
- **Sell mode on mobile.** The mobile frames only draw the Buy tab bar. Sell mode uses the same five items as DX-04 at every width.
- **Avatar.** v2 shows initials ("AO"). The shell has no name for the viewer until T-111, so the profile control shows the person glyph and links to Account.
- **Alerts** left the nav and is the bell, as in v2. `/alerts` still exists as a route.
- **Routes.** v2's `/home`, `/browse`, `/orders` and `/listings` are placeholders until T-207 and T-209. `/explore` became `/browse`.
- **A certified merchant** is held in Sell mode and the switch is locked (design 6.3). v2 does not draw this case.
- **OF1** is unchanged and stays in Buy mode (it is a static page and does not read the mode cookie).
