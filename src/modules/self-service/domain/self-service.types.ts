import { EmploymentStatus } from "@modules/employment-profile/domain/employment-profile.types";
import {
  EventAssignmentKind,
  EventAssignmentStatus,
  EventStatus,
} from "@modules/event-assignment/domain/event-assignment.types";
import { UserAccountStatus } from "@modules/user/domain/user.types";
import {
  WorkShiftSourceType,
  WorkShiftStatus,
} from "@modules/work-schedule/domain/work-schedule.types";

export interface SelfServiceLinkedInternalTalentSummary {
  readonly talentId: string;
  readonly talentCode: string;
  readonly displayName: string;
  readonly performanceAlias: string | null;
}

export interface SelfServiceCurrentPersonView {
  readonly employmentProfileId: string;
  readonly employeeCode: string;
  readonly displayName: string;
  readonly employmentStatus: EmploymentStatus;
  readonly accountEmail?: string;
  readonly accountStatus?: UserAccountStatus;
  readonly accountLinkStatus: "LINKED";
  readonly linkedInternalTalent?: SelfServiceLinkedInternalTalentSummary;
  readonly locale?: string;
  readonly timezone?: string;
}

export interface SelfServiceWorkShiftView {
  readonly workShiftId: string;
  readonly title: string;
  readonly status: WorkShiftStatus;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly sourceType: WorkShiftSourceType;
}

export interface SelfServiceWorkShiftListQuery {
  readonly status?: WorkShiftStatus;
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface SelfServiceWorkShiftListView {
  readonly items: readonly SelfServiceWorkShiftView[];
  readonly nextCursor?: string;
}

export interface SelfServiceEventView {
  readonly eventId: string;
  readonly eventCode: string;
  readonly title: string;
  readonly status: EventStatus;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly ownAssignmentKind: Extract<
    EventAssignmentKind,
    "EMPLOYMENT_PROFILE" | "TALENT"
  >;
  readonly ownAssignmentStatus: EventAssignmentStatus;
}

export interface SelfServiceEventListQuery {
  readonly status?: EventStatus;
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
  readonly limit?: number;
}

export interface SelfServiceEventListView {
  readonly items: readonly SelfServiceEventView[];
}
