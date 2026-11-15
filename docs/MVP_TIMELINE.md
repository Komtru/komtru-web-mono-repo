# MVP timeline — what's left, and in what order

**Drawn 2026-11-15** from the dependency graph in [`tickets/FEATURE_MAP.md`](tickets/FEATURE_MAP.md),
the counts in [`PROGRESS.md`](PROGRESS.md) and the measured pace in
[`manager/RUN_LOG.md`](manager/RUN_LOG.md). Regenerate the ordering with
`python3 tools/tickets/progress.py`; the waves below are the longest-chain depth of the
remaining MVP subgraph, so they only change when a dependency changes.

Standing today: **25 of 52 MVP features done (48%)**, 27 left, about **179 v2 screens** of UI
still to draw.

## 1. The shape of the problem

Everything left hangs off two spines that meet near the end.

```
SPINE A — the seller spine (6 deep, the critical path)

  F-040 ──▶ F-041 ──▶ F-015 ──┬──▶ F-016 ──▶ F-046 ──┬──▶ F-044
  merchant   listings  home &  │     seller   trust &  │     account basics
  cert       & stock   search  │     profile  settings └──▶ F-045
                               │                             verify yourself
SPINE B — the dispute spine (5 deep)                         ▲
                               │                             │
  F-030 ──▶ F-032 ──▶ F-033 ──▶ F-034 ──▶ F-070              │
  cancel &   report    return    replace    desktop/tablet    │
  refund     an issue  track     & settle   resolution        │
      │         │                                            │
      └─────────┴────────────────────────────────────────────┘
                F-032 also feeds F-016, joining the spines
```

Two consequences worth internalising:

- **F-040 is the single most blocking feature in the build.** Merchant certification gates
  listings, which gate search and home, which gate the seller profile, which gates account
  settings, which gates self-verification. Six features sit behind it. Nothing else left in
  the MVP has more than five.
- **Self-serve ID verification (F-045) lands last, not first.** Its backend has been finished
  for weeks, but the screens sit at the bottom of Spine A. Until then no vendor can reach
  level 2, and `FUNDED → SELLER_ACCEPTED` is unreachable in a live system. If that ordering is
  wrong for the business, the fix is to break F-045's dependency on F-046 — not to reorder the
  waves.

## 2. The waves

A wave is "earliest point at which this can start". Work does not have to wait for a whole
wave to finish — a feature is Ready the moment its own parents land.

| Wave              | Features                                               | Why here                           |
| ----------------- | ------------------------------------------------------ | ---------------------------------- |
| **0 — Ready now** | F-030, F-040, F-028, F-005, F-068, F-075, F-076, F-078 | No unfinished MVP parents          |
| **1**             | F-032, F-041, F-031, F-073, F-077                      | Need F-030 / F-040 / F-028 / F-076 |
| **2**             | F-015, F-033, F-035, F-042, F-069, F-080               | Need F-041 or F-032                |
| **3**             | F-016, F-034, F-072                                    | Need F-015 / F-033                 |
| **4**             | F-046, F-067, F-070                                    | Need F-016 / F-034                 |
| **5**             | F-044, F-045                                           | Need F-046                         |

F-076 (end-to-end paths), F-077 (security review) and F-078 (audit + first push) show as Ready
in the raw graph because their named parents are done, but they are **launch gates** and are
only meaningful once the rest is built. `MANAGER.md` step 7 already forbids picking F-075 and
F-078. Treat them as wave 6.

## 3. The timeline

Pace is set by the Pro-plan budget, not the backlog. Measured: **12 features in the 5 days to
2026-11-13**, but that included a second account's session and most were UI layers on finished
backends. Waves 1–5 are mostly new backend _and_ frontend. Plan on **4–6 features a week**.

```
        Nov 17   Nov 24   Dec 1    Dec 8    Dec 15   Dec 22
        │        │        │        │        │        │
  W1    ████████                                             unblock both spines
  W2             ████████                                    seller + dispute engines
  W3                      ████████                           discovery & resolution
  W4                               ████████                  profile, settle, desktop
  W5                                        ████████         account, trust, verify
  W6                                                 ██████  launch gates
```

### Week 1 — Nov 17–23 · start both spines

| Order | Feature              | Work                                    | Note                                                                                                                      |
| ----- | -------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1     | **F-030** UI (T-119) | 8 screens — cancel & refund             | Backend merged 2026-11-12; already the manager's declared next pick. Unblocks the whole dispute spine.                    |
| 2     | **F-040**            | T-055 certification backend + 8 screens | **Start this early even though it is big.** Six features queue behind it. T-051 (business verification) is already built. |
| 3     | **F-005**            | T-029, Redis prefixes                   | No screens. The flaky relay test already cost a run; this pays for itself. Runs in a free lane — backend only.            |
| 4     | **F-028** S13        | Evidence submit seam                    | **Blocked on you** — see §4.                                                                                              |

### Week 2 — Nov 24–30 · the two engines

| Order | Feature   | Work                                                                             |
| ----- | --------- | -------------------------------------------------------------------------------- |
| 1     | **F-032** | Report an issue, open a dispute — 15 screens, the largest single UI feature left |
| 2     | **F-041** | Listings lifecycle, images, stock (T-056) + 5 screens                            |
| 3     | **F-031** | Lifecycle exceptions — 6 screens                                                 |

### Week 3 — Dec 1–7 · discovery opens up

| Order | Feature   | Work                                                                                                                 |
| ----- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| 1     | **F-015** | Search & discovery backend (T-057, tsvector/GIN) + 12 screens. Kills the "Your trades will appear here" placeholder. |
| 2     | **F-033** | Return track — 11 screens                                                                                            |
| 3     | **F-035** | Decide a dispute in TrustOps — 3 screens, **operations-app**, so it can run parallel to any web-app-ui feature       |
| 4     | **F-042** | Shop settings & catalogue import — 8 screens                                                                         |

### Week 4 — Dec 8–14 · profile and settlement

F-016 (reputation backend T-102 + 4 screens) · F-034 (replacement & mutual settlement, 6
screens) · F-080 (multi-item trades) · F-069 (desktop fulfil/deliver/inspect, 9 screens).

### Week 5 — Dec 15–21 · account, trust, and the verification screens

F-046 (trust history & settings, 10 screens) → then **F-044** (12 screens) and **F-045**
(10 screens, the NIN/BVN/liveness flow) · F-067, F-070, F-072, F-073, F-068 fill the
desktop/tablet lane as their parents land.

### Week 6 — Dec 22–28 · launch gates, in strict order

**F-076** end-to-end Playwright paths → **F-077** security review (opus) → **F-075** hosting
and deploy jobs → **F-078** definition-of-done audit and the **first push to the remote**.
Nothing is pushed before F-078.

## 4. What only you can unblock

| #      | Decision                                                                                    | Blocks                                         | Cost of waiting                                                                           |
| ------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Q1** | Hosting target and the GitHub remote                                                        | T-005 (F-075) and the T-183 first push (F-078) | Low until week 6, then total. Decide by **Dec 8** and it never touches the critical path. |
| —      | F-028 CWT-S13 evidence-submit seam: no party-facing call attaches a file to a trade or case | F-028 reaching Done; S12's media-list read     | Small, but it is the last thing between F-028 and Done                                    |

Q16 (city seed) was resolved with a default list of 37 states and 129 cities.

## 5. The throughput ceiling

**Twenty-one of the 27 remaining features are web-app-ui.** Same-app features cannot run in
parallel — F-028 and F-029 collided on `/trade/[id]/evidence` on 2026-11-13 and only merged
cleanly because the conflict was resolved by hand. Shared Postgres and Redis and the migration
sequence serialise the rest.

So the real parallel lanes are narrow:

- **Lane 1 (web-app-ui):** one feature at a time. This is the critical path.
- **Lane 2 (operations-app):** F-035, and F-040's OP-61 reviewer screen.
- **Lane 3 (backend-only / infra):** F-005, F-057 backend work, F-075.

Pairing a web-app-ui feature with a lane-2 or lane-3 feature is the only reliable way to use
the manager's capacity-2 slots. Two web-app-ui features in parallel will cost more than they
save.

## 6. If you want to pull the verification screens forward

F-045's only parent is F-046, and F-046's only parent is F-016 — the chain exists because the
account screens share a shell with trust history. F-045's backend is complete and its API
surface (`/verification/nin`, `/verification/bvn`, `/verification/liveness`,
`/verification/status`) is live. Building VF1 and the seller verification tab against a minimal
shell, ahead of F-046, would move vendor onboarding from week 5 to **week 1 or 2** at the cost
of reworking the shell later. That is a real trade, and it is yours to make.
