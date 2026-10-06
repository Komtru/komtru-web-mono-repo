# T-013 — `ui-kit` layout shells

The shells have no screens of their own: every screen in `SCREEN_INDEX.md` belongs to the ticket
that builds it. So this ticket's visual check shot the four shells against the eight reference
screens that draw them, and the harness filed each review under that screen's own ticket — which is
the right place for it, because when that ticket builds the screen for real it re-runs the same
check and the prose written here survives the regeneration.

| Screen                       | Reference                | Shell under test                          | Story                                        | Flagged |
| ---------------------------- | ------------------------ | ----------------------------------------- | -------------------------------------------- | ------- |
| [E3](../T-111/E3.md)         | Verify Phone             | `MobileShell` + `TopBar` + `StickyFooter` | `Shells/MobileShell` → `VerifyPhone`         | 3.00%   |
| [AC1](../T-113/AC1.md)       | My Trades — Empty State  | `MobileShell` + `LogoBar` + `TabBar`      | `Shells/MobileShell` → `TradesEmpty`         | 7.41%   |
| [D9](../T-110/D9.md)         | Account (sidebar shell)  | `DesktopShell` + `SideNav`                | `Shells/DesktopShell` → `Account`            | 1.36%   |
| [T1](../T-122/T1.md)         | Seller — My Shop         | `DesktopShell` + `TopNav` at tablet       | `Shells/DesktopShell` → `SellerShopTablet`   | 1.90%   |
| [D8](../T-114/D8.md)         | Seller Profile (public)  | `PublicShell`                             | `Shells/PublicShell` → `SellerProfile`       | 2.95%   |
| [T5](../T-114/T5.md)         | Seller Profile at tablet | `PublicShell` with a brand bar            | `Shells/PublicShell` → `SellerProfileTablet` | 1.53%   |
| [NAV](../T-140/NAV.md)       | Persistent left pane     | `ConsoleShell`                            | `Shells/ConsoleShell` → `ParkAgents`         | 1.04%   |
| [TO-PA9](../T-140/TO-PA9.md) | Tablet state             | `ConsoleShell collapsed`                  | `Shells/ConsoleShell` → `TabletRail`         | 0.51%   |

Three deviations account for most of the flagged pixels, and all three are places where the
reference's own markup has no rule behind it:

1. **AC1's logo-row bell** (7.41% → most of it). `.tb-icon` is only ever declared as
   `.scr-topbar .tb-icon`, so the bell inside `.scr-logo-row` is an unstyled `<div>` in the drawing.
   `<LogoBar>` gives it the same 32px round control `<TopBar>` uses, which makes the header 18px
   taller and shifts the body down by the same amount.
2. **NAV's brand mark.** `.ko-dweb-sidebar .ds-logo` declares no `svg` rule, so the reference's mark
   fills its box at ~56px. `<ConsoleShell>` draws it at 16px.
3. **Auto-width primary buttons.** `.btn-primary` is `width:100%` and three of these screens write
   `width:auto` inline. `cx` appends rather than overrides (T-012's documented behaviour), so the
   stories shrink-wrap the button in an `inline-flex` parent.

Everything else is sub-pixel text rasterising and stand-in content that belongs to the screen's own
ticket. The full list is in each `<screen>.md`, scoped to shell chrome versus content.

## Reproducing

The shells live in a component library with no app to serve them, so the built side is Storybook:

```bash
pnpm --filter @komtru/ui-kit build-storybook
cd packages/ui-kit/storybook-static && python3 -m http.server 6013 --bind 127.0.0.1 &
pnpm visual-check --screen NAV --url 'http://127.0.0.1:6013/iframe.html?id=shells-consoleshell--park-agents&viewMode=story'
```

A static build rather than `storybook dev`: the dev server prompts for a new port when 6006 is
taken, and a prompt in a scripted check is a hang.
