import { ReferenceSummary } from "@modules/reference-summary";

export const EVENT_ASSIGNMENT_KINDS = [
  "EMPLOYMENT_PROFILE",
  "TALENT",
  "TALENT_GROUP",
] as const;

export type EventAssignmentKind = (typeof EVENT_ASSIGNMENT_KINDS)[number];

export const EVENT_STATUSES = [
  "DRAFT",
  "PLANNED",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
  "ARCHIVED",
] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_ASSIGNMENT_STATUSES = ["ACTIVE", "REMOVED"] as const;

export type EventAssignmentStatus = (typeof EVENT_ASSIGNMENT_STATUSES)[number];

export const STUDIO_BOOKING_STATUSES = [
  "HELD",
  "CONFIRMED",
  "RELEASED",
  "CANCELLED",
] as const;

export type StudioBookingStatus = (typeof STUDIO_BOOKING_STATUSES)[number];

export const EVENT_SORT_FIELDS = [
  "eventStartAt",
  "eventCode",
  "createdAt",
] as const;

export type EventSortField = (typeof EVENT_SORT_FIELDS)[number];

export const EVENT_SORT_DIRECTIONS = ["ASC", "DESC"] as const;

export type EventSortDirection = (typeof EVENT_SORT_DIRECTIONS)[number];

export const EVENT_SCOPES = ["global", "managedGroup"] as const;

export type EventScope = (typeof EVENT_SCOPES)[number];

export const EVENT_COMPLETION_EVIDENCE_REF_TYPES = [
  "URL",
  "PLATFORM_REFERENCE",
  "EXTERNAL_REFERENCE",
  "INTERNAL_REFERENCE",
] as const;

export type EventCompletionEvidenceRefType =
  (typeof EVENT_COMPLETION_EVIDENCE_REF_TYPES)[number];

export interface EventCompletionEvidenceRef {
  readonly type: EventCompletionEvidenceRefType;
  readonly label: string | null;
  readonly url: string | null;
  readonly referenceId: string | null;
}

export interface EventCompletionSummary {
  readonly completedAt: number | null;
  readonly completedByActorId: string | null;
  readonly evidenceNote: string | null;
  readonly evidenceRefs: readonly EventCompletionEvidenceRef[];
}

export interface EventRecord {
  readonly id: string;
  readonly eventCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly ownerEmploymentProfileId: string;
  /** @deprecated Derived from active StudioBooking records. */
  readonly studioResourceIds: readonly string[];
  readonly platformAccountIds: readonly string[];
  readonly status: EventStatus;
  readonly eventStartAt: number;
  readonly eventEndAt: number;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdByActorId: string;
  readonly updatedByActorId: string;
  readonly plannedAt: number | null;
  readonly plannedByActorId: string | null;
  readonly confirmedAt: number | null;
  readonly confirmedByActorId: string | null;
  readonly completedAt: number | null;
  readonly completedByActorId: string | null;
  readonly completionEvidenceNote: string | null;
  readonly completionEvidenceRefs: readonly EventCompletionEvidenceRef[];
  readonly cancelledAt: number | null;
  readonly cancelledByActorId: string | null;
  readonly cancellationReason: string | null;
  readonly lastRescheduledAt: number | null;
  readonly lastRescheduledByActorId: string | null;
  readonly lastRescheduleReason: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface StudioBookingRecord {
  readonly id: string;
  readonly eventId: string;
  readonly studioResourceId: string;
  readonly bookingStartAt: number;
  readonly bookingEndAt: number;
  readonly status: StudioBookingStatus;
  readonly createdByActorId: string;
  readonly updatedByActorId: string;
  readonly cancelledAt: number | null;
  readonly cancelledByActorId: string | null;
  readonly cancellationReason: string | null;
  readonly releasedAt: number | null;
  readonly releasedByActorId: string | null;
  readonly releaseReason: string | null;
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
  readonly ownerEmploymentProfileId: string;
  readonly ownerEmploymentProfileRef?: ReferenceSummary | null;
  /** @deprecated Derived from active StudioBooking records. */
  readonly studioResourceIds: readonly string[];
  readonly platformAccountIds: readonly string[];
  readonly studioResourceRefs?: readonly ReferenceSummary[];
  readonly platformAccountRefs?: readonly ReferenceSummary[];
  readonly status: EventStatus;
  readonly eventStartAt: number;
  readonly eventEndAt: number;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly plannedAt: number | null;
  readonly confirmedAt: number | null;
  readonly completedAt: number | null;
  readonly completedByActorId: string | null;
  readonly completionEvidence: EventCompletionSummary | null;
  readonly cancelledAt: number | null;
  readonly cancellationReason: string | null;
  readonly lastRescheduledAt: number | null;
  readonly lastRescheduleReason: string | null;
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

export interface StudioBookingView extends StudioBookingRecord {
  readonly studioResourceRef?: ReferenceSummary | null;
  readonly hasConfirmedConflict: boolean;
}

export interface ManagerEventSummaryView {
  readonly id: string;
  readonly eventCode: string;
  readonly title: string;
  readonly status: EventStatus;
  readonly eventStartAt: number;
  readonly eventEndAt: number;
  readonly owner: ReferenceSummary | null;
  readonly participants: readonly ReferenceSummary[];
  readonly completionEvidence: EventCompletionSummary | null;
  readonly studioBookings: readonly {
    readonly id: string;
    readonly status: StudioBookingStatus;
    readonly bookingStartAt: number;
    readonly bookingEndAt: number;
    readonly resource: ReferenceSummary | null;
  }[];
}

export interface EventMutationView extends EventDetailView {}
