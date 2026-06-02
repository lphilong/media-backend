import { EmploymentStatus } from "@modules/employment-profile/domain/employment-profile.types";
import {
  EventAssignmentKind,
  EventAssignmentStatus,
  EventStatus,
} from "@modules/event-assignment/domain/event-assignment.types";
import { UserAccountStatus } from "@modules/user/domain/user.types";
import {
  KpiActualEntryStatusSummary,
  KpiMetricCode,
  KpiMetricUnit,
} from "@modules/kpi/domain/kpi.types";
import { TalentOrigin } from "@modules/talent/domain/talent.types";
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

export interface SelfServiceAccountPreferencesUpdateInput {
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
  readonly meta: {
    readonly window: {
      readonly recentPastDays: number;
      readonly upcomingDays: number;
      readonly windowStartAt: number;
      readonly windowEndAt: number;
    };
    readonly limit: number;
    readonly truncated: boolean;
  };
}

export interface SelfServiceKpiMetricView {
  readonly metricCode: KpiMetricCode;
  readonly unit: KpiMetricUnit;
  readonly targetValue: number;
  readonly actualValue: number;
  readonly progressPercent: number | null;
}

export interface SelfServiceKpiItemView {
  readonly kpiPlanId: string;
  readonly planCode: string;
  readonly title: string;
  readonly periodMonth: string;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly officialStatus: "OFFICIAL_PUBLISHED" | "OFFICIAL_FINALIZED";
  readonly isCurrentPeriod: boolean;
  readonly isPreviousPeriod: boolean;
  readonly isReadOnly: true;
  readonly lastUpdatedAt: number;
  readonly metrics: readonly SelfServiceKpiMetricView[];
  readonly actualEntryStatusSummary: KpiActualEntryStatusSummary;
}

export interface SelfServiceKpiListView {
  readonly items: readonly SelfServiceKpiItemView[];
  readonly current: SelfServiceKpiItemView | null;
  readonly latestPrevious: SelfServiceKpiItemView | null;
  readonly history: readonly SelfServiceKpiItemView[];
}

export interface SelfServiceTalentGroupManagerView {
  readonly displayName: string;
  readonly employeeCode?: string;
}

export interface SelfServiceTalentGroupMemberView {
  readonly talentCode: string;
  readonly displayName: string;
  readonly performanceAlias?: string;
  readonly origin: TalentOrigin;
}

export interface SelfServiceTalentGroupItemView {
  readonly talentGroupCode: string;
  readonly name: string;
  readonly status: "ACTIVE";
  readonly managers: readonly SelfServiceTalentGroupManagerView[];
  readonly members: readonly SelfServiceTalentGroupMemberView[];
  readonly managersTruncated: boolean;
  readonly maxManagers: number;
  readonly membersTruncated: boolean;
  readonly maxMembers: number;
}

export interface SelfServiceTalentGroupListView {
  readonly items: readonly SelfServiceTalentGroupItemView[];
  readonly meta: {
    readonly groupsTruncated: boolean;
    readonly maxGroups: number;
  };
}
