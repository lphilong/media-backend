import { ReferenceSummary } from "@modules/reference-summary";

export const EVENT_ASSIGNMENT_KINDS = [
  "EMPLOYMENT_PROFILE",
  "TALENT",
  "TALENT_GROUP",
] as const;

export type EventAssignmentKind = (typeof EVENT_ASSIGNMENT_KINDS)[number];

export const EVENT_STATUSES = [
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "ARCHIVED",
] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_ASSIGNMENT_STATUSES = ["ACTIVE", "REMOVED"] as const;

export type EventAssignmentStatus = (typeof EVENT_ASSIGNMENT_STATUSES)[number];

export const EVENT_SORT_FIELDS = [
  "eventStartAt",
  "eventCode",
  "createdAt",
] as const;

export type EventSortField = (typeof EVENT_SORT_FIELDS)[number];

export const EVENT_SORT_DIRECTIONS = ["ASC", "DESC"] as const;

export type EventSortDirection = (typeof EVENT_SORT_DIRECTIONS)[number];

export const EVENT_SCOPES = ["global"] as const;

export type EventScope = (typeof EVENT_SCOPES)[number];

export interface EventRecord {
  readonly id: string;
  readonly eventCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly studioResourceIds: readonly string[];
  readonly platformAccountIds: readonly string[];
  readonly status: EventStatus;
  readonly eventStartAt: number;
  readonly eventEndAt: number;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface EventAssignmentRecord {
  readonly id: string;
  readonly eventId: string;
  readonly assignmentKind: EventAssignmentKind;
  readonly assignmentEmploymentProfileId: string | null;
  readonly assignmentTalentId: string | null;
  readonly assignmentTalentGroupId: string | null;
  readonly assignmentStatus: EventAssignmentStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly removedAt: number | null;
}

export interface EventDetailView {
  readonly id: string;
  readonly eventCode: string;
  readonly title: string;
  readonly studioResourceIds: readonly string[];
  readonly platformAccountIds: readonly string[];
  readonly studioResourceRefs?: readonly ReferenceSummary[];
  readonly platformAccountRefs?: readonly ReferenceSummary[];
  readonly status: EventStatus;
  readonly eventStartAt: number;
  readonly eventEndAt: number;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface EventListItemView {
  readonly id: string;
  readonly eventCode: string;
  readonly title: string;
  readonly status: EventStatus;
  readonly eventStartAt: number;
  readonly eventEndAt: number;
  readonly createdAt: number;
}

export interface EventAssignmentListItemView {
  readonly id: string;
  readonly eventId: string;
  readonly assignmentKind: EventAssignmentKind;
  readonly assignmentEmploymentProfileId: string | null;
  readonly assignmentTalentId: string | null;
  readonly assignmentTalentGroupId: string | null;
  readonly assignmentSubjectRef?: ReferenceSummary | null;
  readonly assignmentStatus: EventAssignmentStatus;
  readonly createdAt: number;
}

export interface EventByAssignmentListItemView {
  readonly id: string;
  readonly eventCode: string;
  readonly title: string;
  readonly status: EventStatus;
  readonly eventStartAt: number;
  readonly eventEndAt: number;
}

export interface EventByResourceListItemView {
  readonly id: string;
  readonly eventCode: string;
  readonly title: string;
  readonly status: EventStatus;
  readonly eventStartAt: number;
  readonly eventEndAt: number;
}

export interface EventByPlatformListItemView {
  readonly id: string;
  readonly eventCode: string;
  readonly title: string;
  readonly status: EventStatus;
  readonly eventStartAt: number;
  readonly eventEndAt: number;
}

export interface EventMutationView extends EventDetailView {}
