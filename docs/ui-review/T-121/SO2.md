# SO2 — What Do You Sell? (T-121)

- **Reference:** line 5431 — Become a Seller — Mobile Web · Complete Flow
- **Built:** http://localhost:3001/sell/category
- **Code:** `apps/web-app-ui/src/sell/Category.tsx`

**Visual check not run.** `pnpm visual-check` needs a signed-in session and the platform API for this screen. The app has no harness for the gated routes yet, and the backend infrastructure was not available to this run. The list below is the deviation list from reading the reference against the build; the pixel comparison is still to do.

## Deviations

- **Tiles come from the trade standards.** Names and inspection windows are read from the published standards, not typed. The reference's copy is kept as drawn.
- **Several categories can be chosen.** The reference shows one selected tile; the application holds a list.
- **Generic mark for other categories.** Electronics and Fashion & Luxury have the reference's marks; any other category gets a generic box.
- **Two-column grid from sm.** Tiles stack on mobile and sit side by side from 640px.
- **Step count under the title** (see SO1).
- **Loading, empty and error states added.**
