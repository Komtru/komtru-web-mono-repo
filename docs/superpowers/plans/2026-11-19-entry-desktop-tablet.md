# Entry screens at tablet and desktop width (DX-01, TX-01 and the undrawn rest)

Part of F-067 (desktop, T-207) and F-072 (tablet, T-212). The reference draws two entry screens wide: **DX-01
Welcome / Log in** (desktop) and **TX-01 Log in** (tablet). Every other entry screen is drawn mobile only. The owner's
decision: every entry screen gets DX-01's frame at `lg` (1024px+) and TX-01's card at `md` (768px+); phone is
unchanged and its tests stay untouched.

## One frame, three arrangements

Every screen renders through `EntryFrame`, so the work is the frame plus a handful of per-screen width differences.
`EntryFrame` no longer uses `MobileShell` (a ui-kit component that cannot change); it draws the same header, body and
footer with the same classes, so the phone is the same page, and adds the wide arrangements in the same tree.

| Width           | Arrangement                                                                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| phone < 768     | Unchanged: top bar, body, sticky footer, 480px column centred.                                                                                                                          |
| tablet >= 768   | TX-01: calm `surface-secondary` page, wordmark (and, on log in, the headline) above one centred 600px card holding the body and the actions; "Have a Trade Code? Enter it here".        |
| desktop >= 1024 | DX-01: left brand panel (midnight gradient: wordmark, "Trade with strangers, protected.", three numbered points, Trade Code entry), right column holds the screen on `surface-primary`. |

Resizing never remounts a form: the body and its footer sit in one fixed position in the tree. Layout is CSS (`md:`,
`lg:`). `useViewport` is used only where a width adds content, and only in slots beside the form: the brand panel
(desktop), the tablet intro and Trade Code line, the wide "Back" link in place of the top bar. It answers "mobile" on
the server and in jsdom, so a phone render contains none of them. An empty `aside` (the gradient) is always rendered
so a desktop window shows the right frame before hydration; its contents arrive with the hook.

### What the frame adds, by width

- **Top bar** (`TopBar`, a title and a Back link): phone only. Wide widths draw a plain "Back" link at the top of the
  card or column instead; the body's own heading is the screen's title.
- **Footer** (`StickyFooter`): phone is sticky. At `md` it stops sticking and sits under the form, its buttons side by
  side at their own width (TX-01); at `lg` they stack full width (DX-01). "No sticky footer on desktop".
- **Trade Code entry**. Desktop: a box at the foot of the brand panel on every entry screen (input and Find).
  Tablet: the "Have a Trade Code? Enter it here" line under the card on log in, welcome and sign up only
  (`tradeCode` prop). Both go to the existing find-a-trade flow, `/find` (F-015, `src/home/FindTrade.tsx`); the desktop
  box carries `?code=` so the lookup runs on arrival. Nothing new is built.

### Gap, recorded rather than invented

`/find` is behind the session gate and the lookup endpoint (`GET /trades/by-code/:code`) answers only to a signed-in
person: a logged-out visitor cannot see a trade from a code. The gate sends them to `/login?next=/find?code=...`, so
they log in and the lookup runs. DX-01's "start from a code without an account" therefore starts the visit but does
not finish it without one. The Trade Code box says so in one line ("You'll log in first, then we'll show the
trade."), which the drawing does not carry. A public, rate-limited, party-blind lookup is the only fix and is the
owner's call (it changes what a stranger can learn about a code).

## Screen by screen

Right column = the screen's phone content and actions with the phone copy, actions under the form.

| Screen                                                                               | Tablet card                                                                                | Desktop right column                                                                                                     | Per-screen difference                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1 Welcome `/`                                                                       | Logo, graphic, headline, copy, both buttons, Trade Code                                    | Graphic, copy, both buttons. The headline is the brand panel's, as the page's `h1`.                                      | Body chosen by `useViewport` (it has no state).                                                                                                                                                                                     |
| E4 Log in `/login` (**DX-01, TX-01**)                                                | Wordmark + headline above; fields; Log in and Create account side by side; Trade Code line | "Log in" title and "Use the phone number or email you signed up with.", fields, Forgot password?, Log in, Create account | Label reads "Phone number or email" wide (as drawn). The drawn "Keep me signed in on this device" is **not built**: the platform has no session-length option, so it would be a control that does nothing. Recorded as a deviation. |
| Second factor, too many attempts                                                     | Card                                                                                       | Column                                                                                                                   | None.                                                                                                                                                                                                                               |
| E2 Sign up `/signup`                                                                 | Card, Trade Code line                                                                      | Column                                                                                                                   | None.                                                                                                                                                                                                                               |
| TOS1 `/signup/terms`, `/terms`, TOS2                                                 | Card                                                                                       | Column                                                                                                                   | The terms summary keeps its 280px scroll box.                                                                                                                                                                                       |
| E3, E3b `/verify`                                                                    | Card                                                                                       | Column                                                                                                                   | None.                                                                                                                                                                                                                               |
| AC2, AC3 `/reset-password`, `/new`, `/set-password`                                  | Card                                                                                       | Column                                                                                                                   | None.                                                                                                                                                                                                                               |
| SP-M14/15/16/17 `/status`, `/update-required`, `/session-expired`, too many attempts | Card                                                                                       | Column                                                                                                                   | None.                                                                                                                                                                                                                               |

## Tests (written first)

`test/entry-wide.test.tsx`, using `atWidth` / `resizeTo` / `unwidth` from `test/support/viewport.ts`:

1. Phone: no brand panel, no Trade Code entry, no wide Back link; the top bar is there (the existing suites cover the rest).
2. Desktop, every screen (Welcome, Log in, second factor, Sign up, Terms, Verify, Reset, New password, Terms updated,
   Service Notice, Session expired, Update required, Too many attempts): the brand story (headline, three points) and
   the Trade Code entry, the screen's own heading and actions, no top bar, and an axe pass.
3. Tablet, same screens: wordmark, card content, no brand panel; Trade Code line on log in, welcome and sign up only.
4. Trade Code entry: a valid code goes to `/find?code=KMT-...`; a bad one stays and says what a code looks like.
5. Log in at desktop: DX-01's copy ("Log in", lede, "Phone number or email", Create account) and no "Keep me signed in".
6. **Survives a resize**: type into log in and sign up at phone width, resize to tablet, desktop and back; the typed
   values and the same DOM node remain. Same for a half-ticked terms form.
7. Every suite ends in `expectNoAxeViolations`.

## Visual check

DX-01 and TX-01 through the stand-in against the reference (tablet reference re-rendered at its declared 820px).
Every other screen captured at 1280 and 820 and read by eye. Every entry route loaded in `next start` on port 3301 at
both widths. Notes: `docs/ui-review/T-207/DX-01.md`, `docs/ui-review/T-212/TX-01.md`, `docs/ui-review/entry-wide.md`.

## Not touched

`src/welcome/**`, `src/shell/**`, `src/account/**` (DX-02), `src/trade/**`, `packages/**`, and the ticket indexes.
