# F-084 — the "Finish verifying" card

The card has no frame in the reference: v2 draws neither Home (Z1, H-01, DX-03) nor Shop (Seller-1, H-02, DX-04)
with a verification prompt. So there is nothing for `pnpm visual-check` to score it against, and it was checked
by eye instead, through the stand-in (`docs/runbooks/visual-check.md`) at 340px and 1040px:

- Buy · Home at 340px, `buyer` persona (contacts confirmed, ID not verified): one step, "Verify your ID", marked
  Recommended, with Not now.
- Sell · Shop at 1040px, `buyer` persona: "Verify your ID" marked Required, above the KPI strip.
- Sell · Shop at 340px, `seller` persona (ID verified): no card.

## Deviations

- **An addition, not a reference screen.** It sits above the dashboard's own content, under the heading. It is
  built from the reference's own pieces: the info banner (`NoteBanner`), a settings group, and chips in the tones
  VF1 uses (Required on the warning tone, Recommended and In review on the info tone, Try again on the risk tone).
- **The screens it sits on are otherwise unchanged,** so their own visual-check records (T-113, T-207) still apply.
