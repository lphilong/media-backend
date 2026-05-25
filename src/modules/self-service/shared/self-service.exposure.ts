import {
  PlainObject,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { ExposurePolicy } from "@core/exposure/exposure.policy";
import {
  SelfServiceCurrentPersonView,
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
