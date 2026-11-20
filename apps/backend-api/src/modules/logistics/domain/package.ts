// A package (m2 §3, §6): one row per company-handled trade. The pipeline's transition rules and the
// package service are T-087's; T-085 lands only the statuses the table is declared with.

export const PACKAGE_STATUSES = [
  'REQUESTED',
  'ACCEPTED',
  'REJECTED',
  'PICKED_UP',
  'PACKAGED',
  'SHIPPED',
  'DELIVERED',
] as const;
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];
