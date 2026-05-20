import {
  PlainObject,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { ExposurePolicy } from "@core/exposure/exposure.policy";
import {
  CommissionRuleByBeneficiaryListItemView,
  CommissionRuleByContractListItemView,
  CommissionRuleDetailView,
  CommissionRuleListItemView,
  CommissionRuleMutationView,
  CommissionSettlementByBeneficiaryListItemView,
  CommissionSettlementByRevenueEntryListItemView,
  CommissionSettlementBySubjectTalentListItemView,
  CommissionSettlementDetailView,
  CommissionSettlementLineListItemView,
  CommissionSettlementListItemView,
  CommissionSettlementMutationView,
} from "@modules/commission/domain/commission.types";

const COMMISSION_RULE_DETAIL_FIELDS = [
  "id",
  "ruleCode",
  "title",
  "settlementKind",
  "beneficiaryKind",
  "beneficiaryEmploymentProfileId",
  "beneficiaryTalentId",
  "sourceContractRecordId",
  "beneficiaryRef",
  "sourceContractRecordRef",
  "settlementBasis",
  "ratePercent",
  "appliesToRevenueKinds",
  "status",
  "effectiveStartDate",
  "effectiveEndDate",
  "description",
  "externalRef",
  "createdAt",
  "updatedAt",
] as const;

const COMMISSION_RULE_LIST_FIELDS = [
  "id",
  "ruleCode",
  "title",
  "settlementKind",
  "beneficiaryKind",
  "beneficiaryEmploymentProfileId",
  "beneficiaryTalentId",
  "sourceContractRecordId",
  "beneficiaryRef",
  "sourceContractRecordRef",
  "ratePercent",
  "status",
  "effectiveStartDate",
  "effectiveEndDate",
  "createdAt",
] as const;

const COMMISSION_SETTLEMENT_DETAIL_FIELDS = [
  "id",
  "settlementCode",
  "title",
  "sourceRuleId",
  "sourceContractRecordIdSnapshot",
  "settlementKindSnapshot",
  "beneficiaryKindSnapshot",
  "beneficiaryEmploymentProfileIdSnapshot",
  "beneficiaryTalentIdSnapshot",
  "subjectTalentId",
  "beneficiaryRef",
  "sourceRuleRef",
  "revenueEntryRefs",
  "settlementBasisSnapshot",
  "ratePercentSnapshot",
  "revenueEntryIds",
  "settlementPeriodStartAt",
  "settlementPeriodEndAt",
  "settlementCurrencyCode",
  "grossRevenueAmount",
  "settlementAmount",
  "status",
  "finalizedAt",
  "voidedAt",
  "description",
  "externalRef",
  "createdAt",
  "updatedAt",
] as const;

const COMMISSION_SETTLEMENT_LIST_FIELDS = [
  "id",
  "settlementCode",
  "title",
  "sourceRuleId",
  "settlementKindSnapshot",
  "beneficiaryKindSnapshot",
  "beneficiaryEmploymentProfileIdSnapshot",
  "beneficiaryTalentIdSnapshot",
  "subjectTalentId",
  "revenueEntryIds",
  "beneficiaryRef",
  "sourceRuleRef",
  "revenueEntryRefs",
  "settlementCurrencyCode",
  "grossRevenueAmount",
  "settlementAmount",
  "status",
  "settlementPeriodStartAt",
  "settlementPeriodEndAt",
  "finalizedAt",
  "createdAt",
] as const;

const COMMISSION_SETTLEMENT_LINE_LIST_FIELDS = [
  "id",
  "revenueEntryId",
  "revenueEntryCodeSnapshot",
  "revenueKindSnapshot",
  "revenueCurrencyCodeSnapshot",
  "revenueRecognizedAmountSnapshot",
  "revenueRecognizedAtSnapshot",
  "lineSettlementAmount",
] as const;

const COMMISSION_SETTLEMENT_BY_SUBJECT_TALENT_LIST_FIELDS = [
  "id",
  "settlementCode",
  "title",
  "sourceRuleId",
  "settlementKindSnapshot",
  "beneficiaryKindSnapshot",
  "beneficiaryEmploymentProfileIdSnapshot",
  "beneficiaryTalentIdSnapshot",
  "subjectTalentId",
  "revenueEntryIds",
  "beneficiaryRef",
  "sourceRuleRef",
  "revenueEntryRefs",
  "settlementCurrencyCode",
  "grossRevenueAmount",
  "settlementAmount",
  "status",
  "settlementPeriodStartAt",
  "settlementPeriodEndAt",
  "finalizedAt",
  "createdAt",
] as const;

const COMMISSION_SETTLEMENT_BY_REVENUE_ENTRY_LIST_FIELDS = [
  "id",
  "settlementCode",
  "title",
  "sourceRuleId",
  "settlementKindSnapshot",
  "beneficiaryKindSnapshot",
  "beneficiaryEmploymentProfileIdSnapshot",
  "beneficiaryTalentIdSnapshot",
  "subjectTalentId",
  "revenueEntryIds",
  "beneficiaryRef",
  "sourceRuleRef",
  "revenueEntryRefs",
  "settlementCurrencyCode",
  "grossRevenueAmount",
  "settlementAmount",
  "status",
  "settlementPeriodStartAt",
  "settlementPeriodEndAt",
  "finalizedAt",
  "createdAt",
] as const;

export const CommissionAdminRuleMutationExposure =
  Object.freeze({
    expose(input: CommissionRuleMutationView): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            ruleCode: input.ruleCode,
            title: input.title,
            settlementKind: input.settlementKind,
            beneficiaryKind: input.beneficiaryKind,
            beneficiaryEmploymentProfileId:
              input.beneficiaryEmploymentProfileId,
            beneficiaryTalentId:
              input.beneficiaryTalentId,
            sourceContractRecordId:
              input.sourceContractRecordId,
            beneficiaryRef: input.beneficiaryRef,
            sourceContractRecordRef:
              input.sourceContractRecordRef,
            settlementBasis: input.settlementBasis,
            ratePercent: input.ratePercent,
            appliesToRevenueKinds:
              input.appliesToRevenueKinds,
            status: input.status,
            effectiveStartDate:
              input.effectiveStartDate,
            effectiveEndDate: input.effectiveEndDate,
            description: input.description,
            externalRef: input.externalRef,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          COMMISSION_RULE_DETAIL_FIELDS,
        ),
        "CommissionAdminRuleMutation exposure",
      );
    },
  });

export const CommissionAdminSettlementMutationExposure =
  Object.freeze({
    expose(
      input: CommissionSettlementMutationView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            settlementCode: input.settlementCode,
            title: input.title,
            sourceRuleId: input.sourceRuleId,
            sourceContractRecordIdSnapshot:
              input.sourceContractRecordIdSnapshot,
            settlementKindSnapshot:
              input.settlementKindSnapshot,
            beneficiaryKindSnapshot:
              input.beneficiaryKindSnapshot,
            beneficiaryEmploymentProfileIdSnapshot:
              input.beneficiaryEmploymentProfileIdSnapshot,
            beneficiaryTalentIdSnapshot:
              input.beneficiaryTalentIdSnapshot,
            subjectTalentId: input.subjectTalentId,
            revenueEntryIds: input.revenueEntryIds,
            beneficiaryRef: input.beneficiaryRef,
            sourceRuleRef: input.sourceRuleRef,
            revenueEntryRefs: input.revenueEntryRefs,
            settlementBasisSnapshot:
              input.settlementBasisSnapshot,
            ratePercentSnapshot:
              input.ratePercentSnapshot,
            settlementPeriodStartAt:
              input.settlementPeriodStartAt,
            settlementPeriodEndAt:
              input.settlementPeriodEndAt,
            settlementCurrencyCode:
              input.settlementCurrencyCode,
            grossRevenueAmount:
              input.grossRevenueAmount,
            settlementAmount: input.settlementAmount,
            status: input.status,
            finalizedAt: input.finalizedAt,
            voidedAt: input.voidedAt,
            description: input.description,
            externalRef: input.externalRef,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          COMMISSION_SETTLEMENT_DETAIL_FIELDS,
        ),
        "CommissionAdminSettlementMutation exposure",
      );
    },
  });

export const CommissionAdminRuleDetailExposure =
  Object.freeze({
    expose(input: CommissionRuleDetailView): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            ruleCode: input.ruleCode,
            title: input.title,
            settlementKind: input.settlementKind,
            beneficiaryKind: input.beneficiaryKind,
            beneficiaryEmploymentProfileId:
              input.beneficiaryEmploymentProfileId,
            beneficiaryTalentId:
              input.beneficiaryTalentId,
            sourceContractRecordId:
              input.sourceContractRecordId,
            beneficiaryRef: input.beneficiaryRef,
            sourceContractRecordRef:
              input.sourceContractRecordRef,
            settlementBasis: input.settlementBasis,
            ratePercent: input.ratePercent,
            appliesToRevenueKinds:
              input.appliesToRevenueKinds,
            status: input.status,
            effectiveStartDate:
              input.effectiveStartDate,
            effectiveEndDate: input.effectiveEndDate,
            description: input.description,
            externalRef: input.externalRef,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          COMMISSION_RULE_DETAIL_FIELDS,
        ),
        "CommissionAdminRuleDetail exposure",
      );
    },
  });

export const CommissionAdminRuleListExposure =
  Object.freeze({
    expose(input: CommissionRuleListItemView): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            ruleCode: input.ruleCode,
            title: input.title,
            settlementKind: input.settlementKind,
            beneficiaryKind: input.beneficiaryKind,
            beneficiaryEmploymentProfileId:
              input.beneficiaryEmploymentProfileId,
            beneficiaryTalentId:
              input.beneficiaryTalentId,
            sourceContractRecordId:
              input.sourceContractRecordId,
            beneficiaryRef: input.beneficiaryRef,
            sourceContractRecordRef:
              input.sourceContractRecordRef,
            ratePercent: input.ratePercent,
            status: input.status,
            effectiveStartDate:
              input.effectiveStartDate,
            effectiveEndDate: input.effectiveEndDate,
            createdAt: input.createdAt,
          },
          COMMISSION_RULE_LIST_FIELDS,
        ),
        "CommissionAdminRuleList exposure",
      );
    },

    exposeMany(
      items: readonly CommissionRuleListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const CommissionAdminRuleByBeneficiaryListExposure =
  Object.freeze({
    expose(
      input: CommissionRuleByBeneficiaryListItemView,
    ): PlainObject {
      return CommissionAdminRuleListExposure.expose(
        input,
      );
    },

    exposeMany(
      items: readonly CommissionRuleByBeneficiaryListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const CommissionAdminRuleByContractListExposure =
  Object.freeze({
    expose(
      input: CommissionRuleByContractListItemView,
    ): PlainObject {
      return CommissionAdminRuleListExposure.expose(
        input,
      );
    },

    exposeMany(
      items: readonly CommissionRuleByContractListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const CommissionAdminSettlementDetailExposure =
  Object.freeze({
    expose(
      input: CommissionSettlementDetailView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            settlementCode: input.settlementCode,
            title: input.title,
            sourceRuleId: input.sourceRuleId,
            sourceContractRecordIdSnapshot:
              input.sourceContractRecordIdSnapshot,
            settlementKindSnapshot:
              input.settlementKindSnapshot,
            beneficiaryKindSnapshot:
              input.beneficiaryKindSnapshot,
            beneficiaryEmploymentProfileIdSnapshot:
              input.beneficiaryEmploymentProfileIdSnapshot,
            beneficiaryTalentIdSnapshot:
              input.beneficiaryTalentIdSnapshot,
            subjectTalentId: input.subjectTalentId,
            revenueEntryIds: input.revenueEntryIds,
            beneficiaryRef: input.beneficiaryRef,
            sourceRuleRef: input.sourceRuleRef,
            revenueEntryRefs: input.revenueEntryRefs,
            settlementBasisSnapshot:
              input.settlementBasisSnapshot,
            ratePercentSnapshot:
              input.ratePercentSnapshot,
            settlementPeriodStartAt:
              input.settlementPeriodStartAt,
            settlementPeriodEndAt:
              input.settlementPeriodEndAt,
            settlementCurrencyCode:
              input.settlementCurrencyCode,
            grossRevenueAmount:
              input.grossRevenueAmount,
            settlementAmount: input.settlementAmount,
            status: input.status,
            finalizedAt: input.finalizedAt,
            voidedAt: input.voidedAt,
            description: input.description,
            externalRef: input.externalRef,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          COMMISSION_SETTLEMENT_DETAIL_FIELDS,
        ),
        "CommissionAdminSettlementDetail exposure",
      );
    },
  });

export const CommissionAdminSettlementListExposure =
  Object.freeze({
    expose(
      input: CommissionSettlementListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            settlementCode: input.settlementCode,
            title: input.title,
            sourceRuleId: input.sourceRuleId,
            settlementKindSnapshot:
              input.settlementKindSnapshot,
            beneficiaryKindSnapshot:
              input.beneficiaryKindSnapshot,
            beneficiaryEmploymentProfileIdSnapshot:
              input.beneficiaryEmploymentProfileIdSnapshot,
            beneficiaryTalentIdSnapshot:
              input.beneficiaryTalentIdSnapshot,
            subjectTalentId: input.subjectTalentId,
            revenueEntryIds: input.revenueEntryIds,
            beneficiaryRef: input.beneficiaryRef,
            sourceRuleRef: input.sourceRuleRef,
            revenueEntryRefs: input.revenueEntryRefs,
            settlementCurrencyCode:
              input.settlementCurrencyCode,
            grossRevenueAmount:
              input.grossRevenueAmount,
            settlementAmount: input.settlementAmount,
            status: input.status,
            settlementPeriodStartAt:
              input.settlementPeriodStartAt,
            settlementPeriodEndAt:
              input.settlementPeriodEndAt,
            finalizedAt: input.finalizedAt,
            createdAt: input.createdAt,
          },
          COMMISSION_SETTLEMENT_LIST_FIELDS,
        ),
        "CommissionAdminSettlementList exposure",
      );
    },

    exposeMany(
      items: readonly CommissionSettlementListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const CommissionAdminSettlementLineListExposure =
  Object.freeze({
    expose(
      input: CommissionSettlementLineListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            revenueEntryId: input.revenueEntryId,
            revenueEntryCodeSnapshot:
              input.revenueEntryCodeSnapshot,
            revenueKindSnapshot:
              input.revenueKindSnapshot,
            revenueCurrencyCodeSnapshot:
              input.revenueCurrencyCodeSnapshot,
            revenueRecognizedAmountSnapshot:
              input.revenueRecognizedAmountSnapshot,
            revenueRecognizedAtSnapshot:
              input.revenueRecognizedAtSnapshot,
            lineSettlementAmount:
              input.lineSettlementAmount,
          },
          COMMISSION_SETTLEMENT_LINE_LIST_FIELDS,
        ),
        "CommissionAdminSettlementLineList exposure",
      );
    },

    exposeMany(
      items: readonly CommissionSettlementLineListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const CommissionAdminSettlementByBeneficiaryListExposure =
  Object.freeze({
    expose(
      input: CommissionSettlementByBeneficiaryListItemView,
    ): PlainObject {
      return CommissionAdminSettlementListExposure.expose(
        input,
      );
    },

    exposeMany(
      items: readonly CommissionSettlementByBeneficiaryListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const CommissionAdminSettlementBySubjectTalentListExposure =
  Object.freeze({
    expose(
      input: CommissionSettlementBySubjectTalentListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            settlementCode: input.settlementCode,
            title: input.title,
            sourceRuleId: input.sourceRuleId,
            settlementKindSnapshot:
              input.settlementKindSnapshot,
            beneficiaryKindSnapshot:
              input.beneficiaryKindSnapshot,
            beneficiaryEmploymentProfileIdSnapshot:
              input.beneficiaryEmploymentProfileIdSnapshot,
            beneficiaryTalentIdSnapshot:
              input.beneficiaryTalentIdSnapshot,
            subjectTalentId: input.subjectTalentId,
            revenueEntryIds: input.revenueEntryIds,
            beneficiaryRef: input.beneficiaryRef,
            sourceRuleRef: input.sourceRuleRef,
            revenueEntryRefs: input.revenueEntryRefs,
            settlementCurrencyCode:
              input.settlementCurrencyCode,
            grossRevenueAmount:
              input.grossRevenueAmount,
            settlementAmount: input.settlementAmount,
            status: input.status,
            settlementPeriodStartAt:
              input.settlementPeriodStartAt,
            settlementPeriodEndAt:
              input.settlementPeriodEndAt,
            finalizedAt: input.finalizedAt,
            createdAt: input.createdAt,
          },
          COMMISSION_SETTLEMENT_BY_SUBJECT_TALENT_LIST_FIELDS,
        ),
        "CommissionAdminSettlementBySubjectTalentList exposure",
      );
    },

    exposeMany(
      items: readonly CommissionSettlementBySubjectTalentListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const CommissionAdminSettlementByRevenueEntryListExposure =
  Object.freeze({
    expose(
      input: CommissionSettlementByRevenueEntryListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            settlementCode: input.settlementCode,
            title: input.title,
            sourceRuleId: input.sourceRuleId,
            settlementKindSnapshot:
              input.settlementKindSnapshot,
            beneficiaryKindSnapshot:
              input.beneficiaryKindSnapshot,
            beneficiaryEmploymentProfileIdSnapshot:
              input.beneficiaryEmploymentProfileIdSnapshot,
            beneficiaryTalentIdSnapshot:
              input.beneficiaryTalentIdSnapshot,
            subjectTalentId: input.subjectTalentId,
            revenueEntryIds: input.revenueEntryIds,
            beneficiaryRef: input.beneficiaryRef,
            sourceRuleRef: input.sourceRuleRef,
            revenueEntryRefs: input.revenueEntryRefs,
            settlementCurrencyCode:
              input.settlementCurrencyCode,
            grossRevenueAmount:
              input.grossRevenueAmount,
            settlementAmount: input.settlementAmount,
            status: input.status,
            settlementPeriodStartAt:
              input.settlementPeriodStartAt,
            settlementPeriodEndAt:
              input.settlementPeriodEndAt,
            finalizedAt: input.finalizedAt,
            createdAt: input.createdAt,
          },
          COMMISSION_SETTLEMENT_BY_REVENUE_ENTRY_LIST_FIELDS,
        ),
        "CommissionAdminSettlementByRevenueEntryList exposure",
      );
    },

    exposeMany(
      items: readonly CommissionSettlementByRevenueEntryListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });
