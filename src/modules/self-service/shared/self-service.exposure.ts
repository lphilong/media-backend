import {
  PlainObject,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { ExposurePolicy } from "@core/exposure/exposure.policy";
import {
  SelfServiceCurrentPersonView,
  SelfServiceEventListView,
  SelfServiceEventView,
  SelfServiceKpiItemView,
  SelfServiceKpiListView,
  SelfServiceKpiMetricView,
  SelfServiceTalentGroupItemView,
  SelfServiceTalentGroupListView,
  SelfServiceTalentGroupManagerView,
  SelfServiceTalentGroupMemberView,
  SelfServiceWorkShiftListView,
  SelfServiceWorkShiftView,
} from "@modules/self-service/domain/self-service.types";

const SELF_SERVICE_CURRENT_PERSON_FIELDS = [
  "employmentProfileId",
  "employeeCode",
  "displayName",
  "employmentStatus",
  "accountEmail",
  "accountStatus",
  "accountLinkStatus",
  "linkedInternalTalent",
  "locale",
  "timezone",
] as const;

const SELF_SERVICE_LINKED_INTERNAL_TALENT_FIELDS = [
  "talentId",
  "talentCode",
  "displayName",
  "performanceAlias",
] as const;

const SELF_SERVICE_WORK_SHIFT_FIELDS = [
  "workShiftId",
  "title",
  "status",
  "startsAt",
  "endsAt",
  "sourceType",
] as const;

const SELF_SERVICE_EVENT_FIELDS = [
  "eventId",
  "eventCode",
  "title",
  "status",
  "startsAt",
  "endsAt",
  "ownAssignmentKind",
  "ownAssignmentStatus",
] as const;

const SELF_SERVICE_KPI_METRIC_FIELDS = [
  "metricCode",
  "unit",
  "targetValue",
  "actualValue",
  "progressPercent",
] as const;

const SELF_SERVICE_KPI_ITEM_FIELDS = [
  "kpiPlanId",
  "title",
  "periodMonth",
  "periodStartAt",
  "periodEndAt",
  "officialStatus",
  "lastUpdatedAt",
  "metrics",
] as const;

const SELF_SERVICE_TALENT_GROUP_MANAGER_FIELDS = [
  "displayName",
  "employeeCode",
] as const;

const SELF_SERVICE_TALENT_GROUP_MEMBER_FIELDS = [
  "talentCode",
  "displayName",
  "performanceAlias",
  "origin",
] as const;

const SELF_SERVICE_TALENT_GROUP_FIELDS = [
  "talentGroupCode",
  "name",
  "status",
  "managers",
  "members",
  "managersTruncated",
  "maxManagers",
  "membersTruncated",
  "maxMembers",
] as const;

export const SelfServiceCurrentPersonExposure = Object.freeze({
  expose(input: SelfServiceCurrentPersonView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          employmentProfileId: input.employmentProfileId,
          employeeCode: input.employeeCode,
          displayName: input.displayName,
          employmentStatus: input.employmentStatus,
          accountEmail: input.accountEmail,
          accountStatus: input.accountStatus,
          accountLinkStatus: input.accountLinkStatus,
          linkedInternalTalent: input.linkedInternalTalent
            ? ExposurePolicy.expose(
                {
                  talentId: input.linkedInternalTalent.talentId,
                  talentCode: input.linkedInternalTalent.talentCode,
                  displayName: input.linkedInternalTalent.displayName,
                  performanceAlias:
                    input.linkedInternalTalent.performanceAlias,
                },
                SELF_SERVICE_LINKED_INTERNAL_TALENT_FIELDS,
              )
            : undefined,
          locale: input.locale,
          timezone: input.timezone,
        },
        SELF_SERVICE_CURRENT_PERSON_FIELDS,
      ),
      "SelfServiceCurrentPerson exposure",
    );
  },
});

export const SelfServiceWorkShiftExposure = Object.freeze({
  expose(input: SelfServiceWorkShiftView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          workShiftId: input.workShiftId,
          title: input.title,
          status: input.status,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          sourceType: input.sourceType,
        },
        SELF_SERVICE_WORK_SHIFT_FIELDS,
      ),
      "SelfServiceWorkShift exposure",
    );
  },

  exposeMany(items: readonly SelfServiceWorkShiftView[]): readonly PlainObject[] {
    return items.map((item) => this.expose(item));
  },

  exposeList(input: SelfServiceWorkShiftListView): {
    readonly data: readonly PlainObject[];
    readonly meta?: PlainObject;
  } {
    const output: {
      data: readonly PlainObject[];
      meta?: PlainObject;
    } = {
      data: this.exposeMany(input.items),
    };

    if (input.nextCursor) {
      output.meta = toPlainObject(
        { nextCursor: input.nextCursor },
        "SelfServiceWorkShiftList meta",
      );
    }

    return output;
  },
});

export const SelfServiceEventExposure = Object.freeze({
  expose(input: SelfServiceEventView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          eventId: input.eventId,
          eventCode: input.eventCode,
          title: input.title,
          status: input.status,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          ownAssignmentKind: input.ownAssignmentKind,
          ownAssignmentStatus: input.ownAssignmentStatus,
        },
        SELF_SERVICE_EVENT_FIELDS,
      ),
      "SelfServiceEvent exposure",
    );
  },

  exposeMany(items: readonly SelfServiceEventView[]): readonly PlainObject[] {
    return items.map((item) => this.expose(item));
  },

  exposeList(input: SelfServiceEventListView): {
    readonly data: readonly PlainObject[];
    readonly meta: PlainObject;
  } {
    return {
      data: this.exposeMany(input.items),
      meta: toPlainObject(input.meta, "SelfServiceEventList meta"),
    };
  },
});

export const SelfServiceKpiExposure = Object.freeze({
  exposeMetric(input: SelfServiceKpiMetricView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          metricCode: input.metricCode,
          unit: input.unit,
          targetValue: input.targetValue,
          actualValue: input.actualValue,
          progressPercent: input.progressPercent,
        },
        SELF_SERVICE_KPI_METRIC_FIELDS,
      ),
      "SelfServiceKpiMetric exposure",
    );
  },

  expose(input: SelfServiceKpiItemView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          kpiPlanId: input.kpiPlanId,
          title: input.title,
          periodMonth: input.periodMonth,
          periodStartAt: input.periodStartAt,
          periodEndAt: input.periodEndAt,
          officialStatus: input.officialStatus,
          lastUpdatedAt: input.lastUpdatedAt,
          metrics: input.metrics.map((metric) => this.exposeMetric(metric)),
        },
        SELF_SERVICE_KPI_ITEM_FIELDS,
      ),
      "SelfServiceKpi exposure",
    );
  },

  exposeMany(items: readonly SelfServiceKpiItemView[]): readonly PlainObject[] {
    return items.map((item) => this.expose(item));
  },

  exposeList(input: SelfServiceKpiListView): {
    readonly data: PlainObject;
  } {
    return {
      data: toPlainObject(
        { items: this.exposeMany(input.items) },
        "SelfServiceKpiList exposure",
      ),
    };
  },
});

export const SelfServiceTalentGroupExposure = Object.freeze({
  exposeManager(input: SelfServiceTalentGroupManagerView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          displayName: input.displayName,
          employeeCode: input.employeeCode,
        },
        SELF_SERVICE_TALENT_GROUP_MANAGER_FIELDS,
      ),
      "SelfServiceTalentGroupManager exposure",
    );
  },

  exposeMember(input: SelfServiceTalentGroupMemberView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          talentCode: input.talentCode,
          displayName: input.displayName,
          performanceAlias: input.performanceAlias,
          origin: input.origin,
        },
        SELF_SERVICE_TALENT_GROUP_MEMBER_FIELDS,
      ),
      "SelfServiceTalentGroupMember exposure",
    );
  },

  expose(input: SelfServiceTalentGroupItemView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          talentGroupCode: input.talentGroupCode,
          name: input.name,
          status: input.status,
          managers: input.managers.map((manager) =>
            this.exposeManager(manager),
          ),
          members: input.members.map((member) => this.exposeMember(member)),
          managersTruncated: input.managersTruncated,
          maxManagers: input.maxManagers,
          membersTruncated: input.membersTruncated,
          maxMembers: input.maxMembers,
        },
        SELF_SERVICE_TALENT_GROUP_FIELDS,
      ),
      "SelfServiceTalentGroup exposure",
    );
  },

  exposeMany(
    items: readonly SelfServiceTalentGroupItemView[],
  ): readonly PlainObject[] {
    return items.map((item) => this.expose(item));
  },

  exposeList(input: SelfServiceTalentGroupListView): {
    readonly data: PlainObject;
  } {
    return {
      data: toPlainObject(
        { items: this.exposeMany(input.items), meta: input.meta },
        "SelfServiceTalentGroupList exposure",
      ),
    };
  },
});
