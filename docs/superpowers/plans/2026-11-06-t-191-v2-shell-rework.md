# T-191 plan: rework the T-110 shells to v2

Reference: `docs/design-reference/Komtru — UI Living Master v2.html`, DX-03 (line 8145), DX-04 (8167), TX-02 (8695), Y2 (7459) and the mobile `komtru-mobile-nav` (7481).

## What v2 changes

- Nav is five items. Buy mode: Home, Trades, Messages, Discover, Account. Sell mode (DX-04): Shop, Orders, Listings, Messages, Account. Alerts leaves the nav and becomes the bell in the top bar.
- Desktop: sidebar with a Collapse control, and a top bar with search (`/` focuses it; a Trade Code goes to the trade) and the Buy/Sell switch, bell and profile on the right.
- Tablet: the same five items as top navigation, with the switch, bell and profile at the right of that bar.
- Mobile tab bar: same five items as the desktop nav (v2 `komtru-mobile-nav`).
- A certified merchant is sell-only (design 6.3), so the switch is locked on Sell for them.

## Steps (test first, one commit each)

1. `nav.ts`: modes, the two item sets, `searchDestination`. Tests in `test/nav.test.ts`.
2. ui-kit: `ModeSwitch`, `GlobalSearch`, `SideNav` collapse, `TopNav` actions slot, `ResponsiveAppShell` toolbar. Tests in `packages/ui-kit/test/shells/`.
3. App: icons, `AppShell` wiring, mode cookie and control, new placeholder routes (`/home`, `/browse`, `/orders`, `/listings`), middleware list. Update `test/shell.test.tsx` and axe.
4. Docs: `docs/ui-review/T-191/README.md`.
