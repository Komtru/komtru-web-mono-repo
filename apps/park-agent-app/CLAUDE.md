# park-agent-app

The Park Agent custody app — mobile web, used by vetted agents standing in a motor park. Still a
placeholder package; its tickets turn it into a Next app.

## What makes it different

- **It runs on bad connectivity.** Every mutation must be safely retryable: scan-arrival,
  PIN-validate-handover and mark-damage all need idempotency keys, and the UI must survive a
  retry that the server already applied.
- **Mobile web, not native-feeling.** Browser chrome, no app bezel.
- **Same auth as any courier portal.** A Park Agent is a `logistics_company_members` row on the
  Park company — `scope: 'LOGISTICS'`, its own login route, the same invite lifecycle. This app
  is a different frontend over that same auth, scoped server-side to Park membership only.
  Never let the client choose which company's data it sees.
- **Custody history is append-only.** Every scan, inspection and PIN attempt writes a
  `park_custody_events` row with actor, timestamp, hub and photo reference. Nothing in this app
  edits history.
- **PINs are never held in plaintext** — `pinHash`, with `attemptsCount`, `maxAttempts` and
  `lockedAt`. Exceeding the attempts flags the parcel for TrustOps review.

Screens, per the UI reference: Hub Dashboard, Log Arrival, Physical Inspection, Handover PIN
entry and its mismatch state, damage/exception logging, and the earnings view.
