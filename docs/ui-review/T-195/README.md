# F-028 — Delivery and evidence in the workspace (T-195)

Shot by walking the real screens in a browser against the **v2 master** (`pnpm visual-check --content main`), with `next dev`
behind a stand-in for the platform routes and a sealed session cookie. The pixel scores are the harness's own.
Park is deferred for the MVP, so CWT-S09 and CWT-S11 render the self-arranged path only.

| Screen  | Route                          | State                      | Differing pixels |
| ------- | ------------------------------ | -------------------------- | ---------------- |
| CWT-S08 | `/trade/<id>/dispatch`         | seller, funded             | 9.96%            |
| CWT-S09 | `/trade/<id>/dispatch/waybill` | seller, funded, empty form | 9.06%            |
| CWT-S10 | `/trade/<id>/track`            | buyer, in transit          | 13.41%           |
| CWT-S11 | `/trade/<id>/pickup`           | buyer, in transit          | 20.20%           |
| CWT-S12 | `/trade/<id>/evidence`         | buyer, inspection          | 22.98%           |
| CWT-S13 | `/trade/<id>/evidence/new`     | buyer, inspection, empty   | 8.29%            |

## Judgement

**Pass with the deviations accepted, and two screens that do less than the reference.** Order, copy and components follow
the reference for CWT-S08, S09 and S10. CWT-S11 deliberately drops everything Park (hub, PIN, 12-hour rule). CWT-S12
shows only the media the platform can list, and CWT-S13 is a seam because the platform has no call to attach evidence to a
trade or case: nothing the platform cannot say is drawn as fact. The higher scores for S11 and S12 are layout differences
from that missing content (a shorter card, thumbnails where the reference has grey tiles).

## Update 2026-11-17: CWT-S13 built, CWT-S12 filled

The platform now has a party-facing attach call (`POST /trades/:id/evidence`) and a read by event
(`GET /trades/:id/evidence?event=`), so CWT-S13 is the reference's form and CWT-S12's Delivery and Inspection groups read
real files. The scores above for those two screens are from this run; their `.md` files carry the current deviations.
