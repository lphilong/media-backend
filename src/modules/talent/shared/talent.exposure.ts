import {
  PlainObject,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { ExposurePolicy } from "@core/exposure/exposure.policy";
import {
  TalentDetailView,
  TalentListItemView,
  TalentMutationView,
} from "@modules/talent/domain/talent.types";

const TALENT_ADMIN_LIST_FIELDS = [
  "id",
  "talentCode",
  "displayName",
  "performanceAlias",
  "stageName",
  "legalName",
  "displayShortName",
  "talentOrigin",
  "operationalStatus",
  "linkedEmploymentProfileId",
  "linkedEmploymentProfileRef",
  "commercialParticipationStatus",
  "livestreamEligible",
  "eventEligible",
  "createdAt",
  "updatedAt",
] as const;

const TALENT_ADMIN_DETAIL_FIELDS = [
  "id",
  "talentCode",
  "displayName",
  "performanceAlias",
  "stageName",
  "legalName",
  "displayShortName",
  "talentOrigin",
  "operationalStatus",
  "linkedEmploymentProfileId",
  "linkedEmploymentProfileRef",
  "commercialParticipationStatus",
  "livestreamEligible",
  "eventEligible",
  "externalRef",
  "profileSummary",
  "createdAt",
  "updatedAt",
] as const;

export const TalentAdminListExposure = Object.freeze({
  expose(input: TalentListItemView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          id: input.id,
          talentCode: input.talentCode,
          displayName: input.displayName,
          performanceAlias:
            input.performanceAlias,
          stageName: input.stageName,
          legalName: input.legalName,
          displayShortName:
            input.displayShortName,
          talentOrigin: input.talentOrigin,
          operationalStatus:
            input.operationalStatus,
          linkedEmploymentProfileId:
            input.linkedEmploymentProfileId,
          linkedEmploymentProfileRef:
            input.linkedEmploymentProfileRef,
          commercialParticipationStatus:
            input.commercialParticipationStatus,
          livestreamEligible:
            input.livestreamEligible,
          eventEligible: input.eventEligible,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
        },
        TALENT_ADMIN_LIST_FIELDS,
      ),
      "TalentAdminList exposure",
    );
  },

  exposeMany(
    items: readonly TalentListItemView[],
  ): readonly PlainObject[] {
    return items.map((item) => this.expose(item));
  },
});

export const TalentAdminDetailExposure =
  Object.freeze({
    expose(input: TalentDetailView): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            talentCode: input.talentCode,
            displayName: input.displayName,
            performanceAlias:
              input.performanceAlias,
            stageName: input.stageName,
            legalName: input.legalName,
            displayShortName:
              input.displayShortName,
            talentOrigin: input.talentOrigin,
            operationalStatus:
              input.operationalStatus,
            linkedEmploymentProfileId:
              input.linkedEmploymentProfileId,
            linkedEmploymentProfileRef:
              input.linkedEmploymentProfileRef,
            commercialParticipationStatus:
              input.commercialParticipationStatus,
            livestreamEligible:
              input.livestreamEligible,
            eventEligible: input.eventEligible,
            externalRef: input.externalRef,
            profileSummary: input.profileSummary,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          TALENT_ADMIN_DETAIL_FIELDS,
        ),
        "TalentAdminDetail exposure",
      );
    },
  });

export const TalentAdminMutationExposure =
  Object.freeze({
    expose(input: TalentMutationView): PlainObject {
      return TalentAdminDetailExposure.expose(input);
    },
  });
