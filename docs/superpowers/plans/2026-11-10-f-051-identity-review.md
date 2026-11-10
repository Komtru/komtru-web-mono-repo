# F-051 — Review identity and KYC (T-144, the console half)

Screens: OP-05 People (verification queue) and OP-06 Verification case, in `apps/operations-app`. Backend is T-052 (done):
`/admin/kyc/*`. The console is wired to it through new endpoints in `@komtru/api-client`. No migration, no backend change.

## What the backend gives us (and does not)

- Queue row: case id/number/type/state/priority, SLA due, owner, request id, user id, verification type, submitted at, duplicate flag id/status.
  There is **no person or business name, no provider result string**: only the verification type and the user's id. The "Who" and
  "Provider result" columns of OP-05 are drawn from what exists (type + short user id; "Needs a person" plus the duplicate-flag state).
- Detail: the same row plus the advisory ("AI-suggested — not a decision"). Evidence (facts: why it was parked, attempts, duplicate) and the Trust
  Trail come from the universal case (`GET /cases/:id`, `/trail`), which needs `cases.view`; without it the evidence panel says so.
- Decide: `POST /admin/kyc/queue/:id/decide` (`verification.review`, reason required, optional citation, default `M6 §6.8`); the case must be
  taken first (`/assign`). A flagged request is refused by the backend (409): the UI routes it to the flag instead.
- Flags: `GET /admin/kyc/duplicate-flags` (`duplicate_flag.view`), `POST .../resolve` (`duplicate_flag.resolve`): CONFIRMED_DUPLICATE and
  ESCALATED directly; CLEARED_FALSE_POSITIVE needs an approved `VERIFICATION_OVERRIDE` (`POST /admin/kyc/overrides` with `verification.override`,
  a different holder approves through `POST /admin/approvals/:id/approve`).

## RBAC in the UI (deny by default, mirrors the backend; the backend is still the boundary)

| Thing                     | Needs                                                 |
| ------------------------- | ----------------------------------------------------- |
| Queue tab, detail         | `verification.view`                                   |
| Take, approve, reject     | `verification.review`                                 |
| Flags tab                 | `duplicate_flag.view`                                 |
| Confirm / escalate a flag | `duplicate_flag.resolve`                              |
| Ask for a clearance       | `verification.override` (and resolve to carry it out) |
| Evidence facts and trail  | `cases.view`                                          |
| Reassign to me            | `cases.manage`                                        |

Nothing is loosened: a control is drawn only when its permission is held, and a refused call surfaces the platform's answer.

## Steps (test first, one commit each)

1. `@komtru/api-client` `kyc.ts`: schemas and endpoints for the eight routes plus `approveApproval`. Contract tests (path, scope, retryable, response parse, strict bodies).
2. operations-app hooks (`src/identity/hooks.ts`) and format helpers (`format.ts`): verification type labels, individual/business split, waiting time, "over 24h".
3. OP-05 `/identity`: header, chips All / Individuals / Businesses / Waiting over 24h, table Who / Type / Provider result / Waiting / Review; Duplicate flags tab. States: loading, failed, empty, permission-denied.
4. OP-06 `/identity/[requestId]`: `CaseLayout`, evidence table, `DecisionPanel` (advisory prose only, never fills the form), take / reassign, decision (approve / reject + reason + optional citation), duplicate-flag resolution including the clearance steps.
5. Visual check of OP-05 and OP-06 against the v2 master, deviation lists in `docs/ui-review/F-051/`.
6. Docs: T-144 and F-051 status, FEATURE_MAP, TICKETS.md rows as the workflow requires (done last, only if all acceptance holds).

## Product decisions taken from the docs

- Default rejection code for a queue rejection is the backend's `REVIEW_DECLINED`; the UI sends none.
- Default citation `M6 §6.8` (`M6 §7` for duplicates) is the backend's; the UI leaves the field optional and says so.
- Merchant applications (T-154) and the approvals inbox (T-150) are not built here.
