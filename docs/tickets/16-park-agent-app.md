# Epic 16 — `park-agent-app` (park.komtru.com)

Mobile-web, used at motor-park counters on unreliable connections. Same definition of done as Epic 13. Additional rules for this app:

- Every mutation goes through `api-client`'s durable retry queue with a stable `Idempotency-Key`, and the UI shows queued, sent and confirmed states honestly.
- Hub identity ("Jibowu Park Hub · H-JIB-004") stays visible in the top shell on every screen.
- Camera capture stamps time and hub server-side; the client never asserts a timestamp.
- Order on the dashboard: Arriving, Awaiting pickup, Exceptions, then earnings (gap-audit guidance in the reference).

---

### T-170 — App scaffold, login and hub context
- **Depends on:** T-017, T-092
- **Acceptance criteria:** login via `POST /auth/logistics/login` (first login activates an `INVITED` agent); non-Park logistics members are redirected to `logistics.komtru.com`; hub picker when an agent is assigned to more than one hub; permission flags hide actions the agent cannot perform; offline banner and queue indicator.

### T-171 — Hub dashboard and log arrival
- **Screens:** U1, U2
- **Depends on:** T-170
- **Acceptance criteria:** barcode scan through the camera with manual trade-code entry fallback; drop-off leg asks for the seller's drop-off PIN; arrival leg shows who will collect.

### T-172 — Inspection, damage and incidents
- **Screens:** U3, U6, PA10
- **Depends on:** T-171

### T-173 — Safe handover
- **Screens:** U4, U5
- **Depends on:** T-171
- **Acceptance criteria:** remaining-attempts copy matches the reference ("Two more attempts before this gets flagged for TrustOps review"); locked state after the cap; "Flag this pickup attempt" opens an incident.

### T-174 — Earnings, hub profile and staff
- **Screens:** PE1, PA9
- **Depends on:** T-094, T-091
- **Acceptance criteria:** withdraw only for `can_manage_payouts`; staff invite only for `can_add_staff`, labelled "Requires TrustOps approval before release rights".
