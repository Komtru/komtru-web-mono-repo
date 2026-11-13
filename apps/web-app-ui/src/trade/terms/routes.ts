// The addresses of the trade's supporting screens. Plain strings: the app uses plain anchors (T-110).
export const agreementHref = (tradeId: string): string => `/trade/${tradeId}/agreement`;
export const historyHref = (tradeId: string): string => `/trade/${tradeId}/agreement/history`;
export const fulfilmentHref = (tradeId: string): string => `/trade/${tradeId}/fulfilment`;
export const policiesHref = (tradeId: string): string => `/trade/${tradeId}/policies`;
