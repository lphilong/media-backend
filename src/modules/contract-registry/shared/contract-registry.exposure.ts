import {
  PlainObject,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { ExposurePolicy } from "@core/exposure/exposure.policy";
import {
  ContractRecordByLinkedEntityListItemView,
  ContractRecordByOwnerListItemView,
  ContractRecordDetailView,
  ContractRecordListItemView,
  ContractRecordMutationView,
} from "@modules/contract-registry/domain/contract-registry.types";

const CONTRACT_RECORD_ADMIN_DETAIL_FIELDS = [
  "id",
  "contractCode",
  "title",
  "contractKind",
  "linkedEntityKind",
  "linkedEmploymentProfileId",
  "linkedTalentId",
  "ownerEmploymentProfileId",
  "confidentialityTier",
  "status",
  "effectiveStartDate",
  "effectiveEndDate",
  "fileReferenceId",
  "fileDisplayName",
  "description",
  "externalRef",
  "createdAt",
  "updatedAt",
] as const;

const CONTRACT_RECORD_ADMIN_LIST_FIELDS = [
  "id",
  "contractCode",
  "title",
  "contractKind",
  "linkedEntityKind",
  "linkedEmploymentProfileId",
  "linkedTalentId",
  "ownerEmploymentProfileId",
  "confidentialityTier",
  "status",
  "effectiveStartDate",
  "effectiveEndDate",
  "createdAt",
] as const;

const CONTRACT_RECORD_ADMIN_BY_LINKED_ENTITY_LIST_FIELDS = [
  "id",
  "contractCode",
  "title",
  "contractKind",
  "linkedEntityKind",
  "linkedEmploymentProfileId",
  "linkedTalentId",
  "status",
  "effectiveStartDate",
  "effectiveEndDate",
] as const;

const CONTRACT_RECORD_ADMIN_BY_OWNER_LIST_FIELDS = [
  "id",
  "contractCode",
  "title",
  "contractKind",
  "ownerEmploymentProfileId",
  "confidentialityTier",
  "status",
  "effectiveStartDate",
  "effectiveEndDate",
] as const;

export const ContractRegistryAdminDetailExposure =
  Object.freeze({
    expose(
      input: ContractRecordDetailView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            contractCode: input.contractCode,
            title: input.title,
            contractKind: input.contractKind,
            linkedEntityKind: input.linkedEntityKind,
            linkedEmploymentProfileId:
              input.linkedEmploymentProfileId,
            linkedTalentId: input.linkedTalentId,
            ownerEmploymentProfileId:
              input.ownerEmploymentProfileId,
            confidentialityTier:
              input.confidentialityTier,
            status: input.status,
            effectiveStartDate:
              input.effectiveStartDate,
            effectiveEndDate:
              input.effectiveEndDate,
            fileReferenceId: input.fileReferenceId,
            fileDisplayName:
              input.fileDisplayName,
            description: input.description,
            externalRef: input.externalRef,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          CONTRACT_RECORD_ADMIN_DETAIL_FIELDS,
        ),
        "ContractRegistryAdminDetail exposure",
      );
    },
  });

export const ContractRegistryAdminListExposure =
  Object.freeze({
    expose(
      input: ContractRecordListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            contractCode: input.contractCode,
            title: input.title,
            contractKind: input.contractKind,
            linkedEntityKind: input.linkedEntityKind,
            linkedEmploymentProfileId:
              input.linkedEmploymentProfileId,
            linkedTalentId: input.linkedTalentId,
            ownerEmploymentProfileId:
              input.ownerEmploymentProfileId,
            confidentialityTier:
              input.confidentialityTier,
            status: input.status,
            effectiveStartDate:
              input.effectiveStartDate,
            effectiveEndDate:
              input.effectiveEndDate,
            createdAt: input.createdAt,
          },
          CONTRACT_RECORD_ADMIN_LIST_FIELDS,
        ),
        "ContractRegistryAdminList exposure",
      );
    },

    exposeMany(
      items: readonly ContractRecordListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const ContractRegistryAdminByLinkedEntityListExposure =
  Object.freeze({
    expose(
      input: ContractRecordByLinkedEntityListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            contractCode: input.contractCode,
            title: input.title,
            contractKind: input.contractKind,
            linkedEntityKind: input.linkedEntityKind,
            linkedEmploymentProfileId:
              input.linkedEmploymentProfileId,
            linkedTalentId: input.linkedTalentId,
            status: input.status,
            effectiveStartDate:
              input.effectiveStartDate,
            effectiveEndDate:
              input.effectiveEndDate,
          },
          CONTRACT_RECORD_ADMIN_BY_LINKED_ENTITY_LIST_FIELDS,
        ),
        "ContractRegistryAdminByLinkedEntityList exposure",
      );
    },

    exposeMany(
      items: readonly ContractRecordByLinkedEntityListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const ContractRegistryAdminByOwnerListExposure =
  Object.freeze({
    expose(
      input: ContractRecordByOwnerListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            contractCode: input.contractCode,
            title: input.title,
            contractKind: input.contractKind,
            ownerEmploymentProfileId:
              input.ownerEmploymentProfileId,
            confidentialityTier:
              input.confidentialityTier,
            status: input.status,
            effectiveStartDate:
              input.effectiveStartDate,
            effectiveEndDate:
              input.effectiveEndDate,
          },
          CONTRACT_RECORD_ADMIN_BY_OWNER_LIST_FIELDS,
        ),
        "ContractRegistryAdminByOwnerList exposure",
      );
    },

    exposeMany(
      items: readonly ContractRecordByOwnerListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const ContractRegistryAdminMutationExposure =
  Object.freeze({
    expose(
      input: ContractRecordMutationView,
    ): PlainObject {
      return ContractRegistryAdminDetailExposure.expose(
        input,
      );
    },
  });
