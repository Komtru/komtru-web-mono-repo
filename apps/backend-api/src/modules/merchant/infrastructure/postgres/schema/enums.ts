import { BUSINESS_TYPES, DOCUMENT_TYPES } from '../../../domain/application.js';
import { MERCHANT_APPLICATION_STATUSES } from '../../../domain/status.js';
import { merchant } from './columns.js';

export const EVENT_ACTOR_TYPES = ['APPLICANT', 'STAFF', 'SYSTEM'] as const;
export const CERTIFICATION_STATUSES = ['CERTIFIED', 'SUSPENDED', 'REVOKED'] as const;
export const BADGE_TYPES = ['VERIFIED_MERCHANT'] as const;

export const applicationStatus = merchant.enum('application_status', [...MERCHANT_APPLICATION_STATUSES]);
export const businessType = merchant.enum('business_type', [...BUSINESS_TYPES]);
export const documentType = merchant.enum('document_type', [...DOCUMENT_TYPES]);
export const eventActorType = merchant.enum('event_actor_type', [...EVENT_ACTOR_TYPES]);
export const certificationStatus = merchant.enum('certification_status', [...CERTIFICATION_STATUSES]);
export const badgeType = merchant.enum('badge_type', [...BADGE_TYPES]);

export type EventActorType = (typeof EVENT_ACTOR_TYPES)[number];
export type CertificationStatus = (typeof CERTIFICATION_STATUSES)[number];
