# TO-PA2 — Application Review — TrustOps Case (T-147)

- **Reference:** `docs/design-reference/Komtru — UI Screens Living Master File.html` line 8855 — TrustOps Console — Desktop · Park Agent queue & lifecycle controls
- **Built:** http://localhost:6006/iframe.html?id=trustops-caselayout--application-review&viewMode=story
- **Frame:** desktop, 1040px reference frame; compared at 1040 × 652
- **Differing pixels:** 28,344 of 678,080 (4.18%)
- **Side by side:** `TO-PA2.png` (reference · built · heat map) — **heat map:** `TO-PA2.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

1. **The lifecycle badge is amber, not indigo.** The reference draws `.p13-state.review` — an indigo
   `--info-soft` / `--info-on-soft` pill with a leading dot. `ui-kit`'s `<Chip>` (T-012) has five
   tones and none of them is indigo, so the story passes `tone="awaiting"`. `CaseLayout` takes
   `status` as a `ReactNode`, so a screen can pass anything; closing this properly needs either a
   sixth `Chip` tone or an exported `.p13-state` badge, and both belong to the component that owns
   `Chip`. Deferred.
2. **`.p13-audit` ("Assigned to: Ifeoma K.") and `.p13-danger` ("Activation guard") are absent.**
   Reviewer assignment and the activation guard are screen furniture, owned by T-147, not patterns
   T-014 was asked for. The `.p13-audit` treatment itself _is_ shipped — it is the emerald rule under
   `TrustTrail`'s caption — but it is not a standalone export. This is the largest single block of
   heat on the page.
3. **The policy cite joins its trailing clause with `—`; the reference writes `·` on this screen.**
   The reference uses both glyphs (N2 line 3631 uses `—`, TO-PA2 line 8884 uses `·`). `PolicyCite`
   prints one of them. Deferred: a `joiner` prop for one character is worse than the inconsistency.
4. **Evidence rows drift ~2px lower each, ~8px by the fourth.** Same cause as N2 item 4: no global
   body line-height. The row pitch, the 28px icon tile, the 11.5px label and the 10.5px/1.4 detail
   all match; the accumulation is line-box rounding.
5. **Everything else matches:** the four `.p13-req` rows with their `--info-soft` icon tiles, the
   Pass / Gap / Check badges in `ready` / `hold` / `review` colours sitting immediately after the
   text the way the reference lets them (not right-aligned), the dashed advisory, the divider, the
   three actions and the mono policy cite.
