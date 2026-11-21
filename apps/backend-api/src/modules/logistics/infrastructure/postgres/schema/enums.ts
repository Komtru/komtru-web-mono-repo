import { COMPANY_STATUSES } from '../../../domain/company.js';
import { INVITATION_CHANNELS } from '../../../domain/contact.js';
import { MEMBER_ROLES, MEMBER_STATUSES } from '../../../domain/membership.js';
import { PACKAGE_STATUSES } from '../../../domain/package.js';
import { logistics } from './columns.js';

export const INVITATION_STATUSES = ['PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const companyStatus = logistics.enum('company_status', [...COMPANY_STATUSES]);
export const memberRole = logistics.enum('member_role', [...MEMBER_ROLES]);
export const memberStatus = logistics.enum('member_status', [...MEMBER_STATUSES]);
export const invitationStatus = logistics.enum('invitation_status', [...INVITATION_STATUSES]);
export const invitationChannel = logistics.enum('invitation_channel', [...INVITATION_CHANNELS]);
export const packageStatus = logistics.enum('package_status', [...PACKAGE_STATUSES]);
