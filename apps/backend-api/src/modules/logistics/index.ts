// The logistics module's public surface (m2 §4): the schema other modules read, the events it
// publishes, the two functions identity's ports are wired to, and the module itself. The
// komtru/module-boundaries rule makes this the only way in.
export * from './infrastructure/postgres/schema/index.js';
export * from './domain/events.js';
export {
  COMPANY_STATUSES,
  PARK_COMPANY_ID,
  PARK_COMPANY_NAME,
  type CompanyStatus,
} from './domain/company.js';
export { MEMBER_ROLES, MEMBER_STATUSES, type MemberRole, type MemberStatus } from './domain/membership.js';
export { PACKAGE_STATUSES, type PackageStatus } from './domain/package.js';
export { acceptOnLogin, activeMembership, hasLogisticsAccess } from './services/access.service.js';
export { createLogisticsModule, logisticsModule } from './module.js';
