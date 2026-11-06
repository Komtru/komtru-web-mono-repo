# Console sidebar: section to permission mapping (T-140)

Source of truth: `apps/operations-app/src/shell/nav.ts`. A section is drawn, and its page opens, when the signed-in person holds **at least one** of its permissions. Codes are the T-037 catalogue (`apps/backend-api/src/modules/identity/domain/rbac/catalog.ts`); a test fails if the console's copy of the list drifts from it.

Hiding an item is a courtesy and not the boundary. The backend checks the permission on every call, and the console's middleware only turns away a session that is not `STAFF`.

| Section               | Path           | Opens with any of                                                       | Why                                                                                              |
| --------------------- | -------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Work Queue            | `/queue`       | `cases.view`                                                            | The universal case list (T-141) reads cases.                                                     |
| Trades                | `/trades`      | `trade.view`, `trade.view_all`                                          | In-scope or any trade.                                                                           |
| Disputes              | `/disputes`    | `dispute.view`                                                          | Reading a case is the floor for the whole section; deciding and assigning are actions inside it. |
| Identity / KYB        | `/identity`    | `verification.view`, `merchant.application.view`, `duplicate_flag.view` | Three queues share one case layout (T-144, T-154), so any one of the three views opens it.       |
| Fraud & Risk          | `/risk`        | `risk.view`                                                             | The fraud review queue.                                                                          |
| Park Hubs             | `/hubs`        | `park.view`                                                             | Read the Park network.                                                                           |
| Parcels / Custody     | `/custody`     | `logistics.manage`, `park.view`                                         | Custody runs through the Park network; shipment exceptions are the logistics operator's.         |
| Payments / Settlement | `/payments`    | `payment.view`, `payout.view`, `reconciliation.view`                    | Any of the three money reads.                                                                    |
| Trust Graph           | `/trust-graph` | `risk.view`, `duplicate_flag.view`                                      | The investigation view (device graph, duplicate identities); the fraud analyst's tool.           |
| Audit / Trust Trail   | `/audit`       | `audit.view`, `compliance.view`                                         | The audit log and the compliance access log.                                                     |
| Policies              | `/policies`    | `config.view`                                                           | Read platform configuration; editing needs `config.manage` inside the section.                   |
| Reports               | `/reports`     | `analytics.view`, `analytics.run_report`                                | Dashboards or on-demand reports.                                                                 |

Rules that follow from this:

- A permission to _act_ (`risk.resolve`, `payment.refund`, `config.manage`) opens nothing on its own: every role the catalogue gives an action also gives its read.
- A code the console does not know is dropped, not trusted.
- Until `GET /admin/me` answers, the viewer holds nothing and the rail is empty. My account and Sign out are always in the rail.

## Judgement calls to confirm

- **Trust Graph** has no permission of its own in the catalogue. It borrows the two the investigation reads need; a dedicated `trust_graph.view` is the cleaner answer if the owner wants one.
- **Parcels / Custody** shares `park.view` with Park Hubs for the same reason.
- OP-01 draws a nine-item rail (Today, My work, Trades, Money, Custody, People, Cases, Search and audit, Team and access). The ticket's twelve sections replace it: the ticket is the acceptance criterion, and later tickets (T-141 onward) decide where Today, My work, People and Team and access live.
