import {
  PlainObject,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { ExposurePolicy } from "@core/exposure/exposure.policy";
import {
  EmploymentProfileDetailView,
  EmploymentProfileDirectReportListItemView,
  EmploymentProfileListItemView,
  EmploymentProfileMutationView,
} from "@modules/employment-profile/domain/employment-profile.types";

const EMPLOYMENT_PROFILE_ADMIN_LIST_FIELDS = [
  "id",
  "employeeCode",
  "legalName",
  "displayName",
  "employmentKind",
  "jobTitle",
  "orgUnitId",
  "orgUnitRef",
  "recruiterEmploymentProfileId",
  "recruiterEmploymentProfileRef",
  "hrOwnerEmploymentProfileId",
  "hrOwnerEmploymentProfileRef",
  "onboardingOwnerEmploymentProfileId",
  "onboardingOwnerEmploymentProfileRef",
  "sourcedByEmploymentProfileId",
  "sourcedByEmploymentProfileRef",
  "linkedUserId",
  "linkedUserRef",
  "employmentStatus",
  "contractStatus",
  "hiredAt",
  "onboardedAt",
  "createdAt",
] as const;

const EMPLOYMENT_PROFILE_ADMIN_DIRECT_REPORT_FIELDS = [
  "id",
  "employeeCode",
  "displayName",
  "employmentStatus",
  "contractStatus",
  "orgUnitId",
  "orgUnitRef",
] as const;

const EMPLOYMENT_PROFILE_ADMIN_DETAIL_FIELDS = [
  "id",
  "employeeCode",
  "legalName",
  "displayName",
  "employmentKind",
  "jobTitle",
  "titleDescription",
  "externalRef",
  "orgUnitId",
  "orgUnitRef",
  "recruiterEmploymentProfileId",
  "recruiterEmploymentProfileRef",
  "hrOwnerEmploymentProfileId",
  "hrOwnerEmploymentProfileRef",
  "onboardingOwnerEmploymentProfileId",
  "onboardingOwnerEmploymentProfileRef",
  "sourcedByEmploymentProfileId",
  "sourcedByEmploymentProfileRef",
  "linkedUserId",
  "linkedUserRef",
  "employmentStatus",
  "contractStatus",
  "employmentStartDate",
  "employmentEndDate",
  "hiredAt",
  "onboardedAt",
  "createdAt",
  "updatedAt",
] as const;

export const EmploymentProfileAdminListExposure =
  Object.freeze({
    expose(
      input:
        | EmploymentProfileListItemView
        | EmploymentProfileDirectReportListItemView,
    ): PlainObject {
      if (isListItemView(input)) {
        return toPlainObject(
          ExposurePolicy.expose(
            {
              id: input.id,
              employeeCode: input.employeeCode,
              legalName: input.legalName,
              displayName: input.displayName,
              employmentKind: input.employmentKind,
              jobTitle: input.jobTitle,
              orgUnitId: input.orgUnitId,
              orgUnitRef: input.orgUnitRef,
              recruiterEmploymentProfileId:
                input.recruiterEmploymentProfileId,
              recruiterEmploymentProfileRef:
                input.recruiterEmploymentProfileRef,
              hrOwnerEmploymentProfileId:
                input.hrOwnerEmploymentProfileId,
              hrOwnerEmploymentProfileRef:
                input.hrOwnerEmploymentProfileRef,
              onboardingOwnerEmploymentProfileId:
                input.onboardingOwnerEmploymentProfileId,
              onboardingOwnerEmploymentProfileRef:
                input.onboardingOwnerEmploymentProfileRef,
              sourcedByEmploymentProfileId:
                input.sourcedByEmploymentProfileId,
              sourcedByEmploymentProfileRef:
                input.sourcedByEmploymentProfileRef,
              linkedUserId: input.linkedUserId,
              linkedUserRef: input.linkedUserRef,
              employmentStatus:
                input.employmentStatus,
              contractStatus: input.contractStatus,
              hiredAt: input.hiredAt,
              onboardedAt: input.onboardedAt,
              createdAt: input.createdAt,
            },
            EMPLOYMENT_PROFILE_ADMIN_LIST_FIELDS,
          ),
          "EmploymentProfileAdminList exposure",
        );
      }

      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            employeeCode: input.employeeCode,
            displayName: input.displayName,
            orgUnitId: input.orgUnitId,
            orgUnitRef: input.orgUnitRef,
            employmentStatus: input.employmentStatus,
            contractStatus: input.contractStatus,
          },
          EMPLOYMENT_PROFILE_ADMIN_DIRECT_REPORT_FIELDS,
        ),
        "EmploymentProfileAdminDirectReports exposure",
      );
    },

    exposeMany(
      items: ReadonlyArray<
        | EmploymentProfileListItemView
        | EmploymentProfileDirectReportListItemView
      >,
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const EmploymentProfileAdminDetailExposure =
  Object.freeze({
    expose(
      input: EmploymentProfileDetailView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            employeeCode: input.employeeCode,
            legalName: input.legalName,
            displayName: input.displayName,
            employmentKind: input.employmentKind,
            jobTitle: input.jobTitle,
            titleDescription:
              input.titleDescription,
            externalRef: input.externalRef,
            orgUnitId: input.orgUnitId,
            orgUnitRef: input.orgUnitRef,
            recruiterEmploymentProfileId:
              input.recruiterEmploymentProfileId,
            recruiterEmploymentProfileRef:
              input.recruiterEmploymentProfileRef,
            hrOwnerEmploymentProfileId:
              input.hrOwnerEmploymentProfileId,
            hrOwnerEmploymentProfileRef:
              input.hrOwnerEmploymentProfileRef,
            onboardingOwnerEmploymentProfileId:
              input.onboardingOwnerEmploymentProfileId,
            onboardingOwnerEmploymentProfileRef:
              input.onboardingOwnerEmploymentProfileRef,
            sourcedByEmploymentProfileId:
              input.sourcedByEmploymentProfileId,
            sourcedByEmploymentProfileRef:
              input.sourcedByEmploymentProfileRef,
            linkedUserId: input.linkedUserId,
            linkedUserRef: input.linkedUserRef,
            employmentStatus: input.employmentStatus,
            contractStatus: input.contractStatus,
            employmentStartDate:
              input.employmentStartDate,
            employmentEndDate:
              input.employmentEndDate,
            hiredAt: input.hiredAt,
            onboardedAt: input.onboardedAt,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          EMPLOYMENT_PROFILE_ADMIN_DETAIL_FIELDS,
        ),
        "EmploymentProfileAdminDetail exposure",
      );
    },
  });

export const EmploymentProfileAdminMutationExposure =
  Object.freeze({
    expose(
      input: EmploymentProfileMutationView,
    ): PlainObject {
      return EmploymentProfileAdminDetailExposure.expose(
        input,
      );
    },
  });

function isListItemView(
  input:
    | EmploymentProfileListItemView
    | EmploymentProfileDirectReportListItemView,
): input is EmploymentProfileListItemView {
  return (
    "legalName" in input &&
    "employmentKind" in input &&
    "jobTitle" in input &&
    "linkedUserId" in input &&
    "createdAt" in input
  );
}
