import {
  PlainObject,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { ExposurePolicy } from "@core/exposure/exposure.policy";
import { SelfServiceCurrentPersonView } from "@modules/self-service/domain/self-service.types";

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
