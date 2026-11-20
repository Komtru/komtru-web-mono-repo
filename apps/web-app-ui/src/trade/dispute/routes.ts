// Where the dispute screens live. Plain strings: the app uses plain anchors (T-110), not
// next/link.
//
// The reference writes SP-M23's URL as `/trades/<code>/dispute/withdraw` and every other dispute
// screen as `/trade/<id>/...`. The app's own convention is `/trade/<uuid>/...` throughout, and one
// screen on a different scheme would be the only place in the app where a trade code appears in a
// path. Recorded as a deviation in the ui-review file.
export const tradeHref = (id: string): string => `/trade/${id}`;

/** C7 / CWT-S14: report an issue on the whole trade. */
export const reportIssueHref = (id: string): string => `/trade/${id}/dispute`;

/** DI-01: the structured intake every report funnels through. */
export const issueReviewHref = (id: string): string => `/trade/${id}/issue`;

/** CWT-S17: report one item of a multi-item order. */
export const reportItemHref = (id: string): string => `/trade/${id}/dispute/item`;

/** C8 / CWT-S15 / CWT-S18 / H1 / H2: where the case stands, and how it ended. */
export const disputeStatusHref = (id: string): string => `/trade/${id}/dispute/status`;

/** Y1: the side-by-side comparison. */
export const comparisonHref = (id: string): string => `/trade/${id}/dispute/evidence`;

/** AC6. */
export const appealHref = (id: string): string => `/trade/${id}/appeal`;

/** SP-M23. */
export const withdrawHref = (id: string): string => `/trade/${id}/dispute/withdraw`;

/** Seller-8: the seller's written response, reached from Seller-7's "Respond with evidence". */
export const respondHref = (id: string): string => `/trade/${id}/dispute/respond`;
