import {
  PlainObject,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { ExposurePolicy } from "@core/exposure/exposure.policy";
import {
  RevenueEntryByEventListItemView,
  RevenueEntryByPlatformListItemView,
  RevenueEntryByTalentListItemView,
  RevenueEntryDetailView,
  RevenueEntryListItemView,
  RevenueEntryMutationView,
} from "@modules/revenue-ledger/domain/revenue-ledger.types";

const REVENUE_LEDGER_ADMIN_DETAIL_FIELDS = [
  "id",
  "revenueEntryCode",
  "title",
  "subjectTalentId",
  "attributionPlatformAccountId",
  "attributionEventId",
  "subjectTalentRef",
  "attributionPlatformAccountRef",
  "attributionEventRef",
  "revenueKind",
  "entrySource",
  "status",
  "currencyCode",
  "recognizedAmount",
  "recognizedAt",
  "finalizedAt",
  "reconciledAt",
  "voidedAt",
  "reconciliationReference",
  "description",
  "externalRef",
  "createdAt",
  "updatedAt",
] as const;

const REVENUE_LEDGER_ADMIN_LIST_FIELDS = [
  "id",
  "revenueEntryCode",
  "title",
  "subjectTalentId",
  "attributionPlatformAccountId",
  "attributionEventId",
  "subjectTalentRef",
  "attributionPlatformAccountRef",
  "attributionEventRef",
  "revenueKind",
  "entrySource",
  "status",
  "currencyCode",
  "recognizedAmount",
  "recognizedAt",
  "createdAt",
] as const;

const REVENUE_LEDGER_ADMIN_BY_TALENT_LIST_FIELDS = [
  "id",
  "revenueEntryCode",
  "title",
  "subjectTalentId",
  "revenueKind",
  "status",
  "currencyCode",
  "recognizedAmount",
  "recognizedAt",
] as const;

const REVENUE_LEDGER_ADMIN_BY_PLATFORM_LIST_FIELDS = [
  "id",
  "revenueEntryCode",
  "title",
  "subjectTalentId",
  "attributionPlatformAccountId",
  "revenueKind",
  "status",
  "currencyCode",
  "recognizedAmount",
  "recognizedAt",
] as const;

const REVENUE_LEDGER_ADMIN_BY_EVENT_LIST_FIELDS = [
  "id",
  "revenueEntryCode",
  "title",
  "subjectTalentId",
  "attributionEventId",
  "revenueKind",
  "status",
  "currencyCode",
  "recognizedAmount",
  "recognizedAt",
] as const;

export const RevenueLedgerAdminDetailExposure =
  Object.freeze({
    expose(
      input: RevenueEntryDetailView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            revenueEntryCode: input.revenueEntryCode,
            title: input.title,
            subjectTalentId: input.subjectTalentId,
            attributionPlatformAccountId:
              input.attributionPlatformAccountId,
            attributionEventId:
              input.attributionEventId,
            subjectTalentRef: input.subjectTalentRef,
            attributionPlatformAccountRef:
              input.attributionPlatformAccountRef,
            attributionEventRef:
              input.attributionEventRef,
            revenueKind: input.revenueKind,
            entrySource: input.entrySource,
            status: input.status,
            currencyCode: input.currencyCode,
            recognizedAmount:
              input.recognizedAmount,
            recognizedAt: input.recognizedAt,
            finalizedAt: input.finalizedAt,
            reconciledAt: input.reconciledAt,
            voidedAt: input.voidedAt,
            reconciliationReference:
              input.reconciliationReference,
            description: input.description,
            externalRef: input.externalRef,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          REVENUE_LEDGER_ADMIN_DETAIL_FIELDS,
        ),
        "RevenueLedgerAdminDetail exposure",
      );
    },
  });

export const RevenueLedgerAdminListExposure =
  Object.freeze({
    expose(
      input: RevenueEntryListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            revenueEntryCode: input.revenueEntryCode,
            title: input.title,
            subjectTalentId: input.subjectTalentId,
            attributionPlatformAccountId:
              input.attributionPlatformAccountId,
            attributionEventId:
              input.attributionEventId,
            subjectTalentRef: input.subjectTalentRef,
            attributionPlatformAccountRef:
              input.attributionPlatformAccountRef,
            attributionEventRef:
              input.attributionEventRef,
            revenueKind: input.revenueKind,
            entrySource: input.entrySource,
            status: input.status,
            currencyCode: input.currencyCode,
            recognizedAmount:
              input.recognizedAmount,
            recognizedAt: input.recognizedAt,
            createdAt: input.createdAt,
          },
          REVENUE_LEDGER_ADMIN_LIST_FIELDS,
        ),
        "RevenueLedgerAdminList exposure",
      );
    },

    exposeMany(
      items: readonly RevenueEntryListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const RevenueLedgerAdminByTalentListExposure =
  Object.freeze({
    expose(
      input: RevenueEntryByTalentListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            revenueEntryCode: input.revenueEntryCode,
            title: input.title,
            subjectTalentId: input.subjectTalentId,
            revenueKind: input.revenueKind,
            status: input.status,
            currencyCode: input.currencyCode,
            recognizedAmount:
              input.recognizedAmount,
            recognizedAt: input.recognizedAt,
          },
          REVENUE_LEDGER_ADMIN_BY_TALENT_LIST_FIELDS,
        ),
        "RevenueLedgerAdminByTalentList exposure",
      );
    },

    exposeMany(
      items: readonly RevenueEntryByTalentListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const RevenueLedgerAdminByPlatformListExposure =
  Object.freeze({
    expose(
      input: RevenueEntryByPlatformListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            revenueEntryCode: input.revenueEntryCode,
            title: input.title,
            subjectTalentId: input.subjectTalentId,
            attributionPlatformAccountId:
              input.attributionPlatformAccountId,
            revenueKind: input.revenueKind,
            status: input.status,
            currencyCode: input.currencyCode,
            recognizedAmount:
              input.recognizedAmount,
            recognizedAt: input.recognizedAt,
          },
          REVENUE_LEDGER_ADMIN_BY_PLATFORM_LIST_FIELDS,
        ),
        "RevenueLedgerAdminByPlatformList exposure",
      );
    },

    exposeMany(
      items: readonly RevenueEntryByPlatformListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const RevenueLedgerAdminByEventListExposure =
  Object.freeze({
    expose(
      input: RevenueEntryByEventListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            revenueEntryCode: input.revenueEntryCode,
            title: input.title,
            subjectTalentId: input.subjectTalentId,
            attributionEventId:
              input.attributionEventId,
            revenueKind: input.revenueKind,
            status: input.status,
            currencyCode: input.currencyCode,
            recognizedAmount:
              input.recognizedAmount,
            recognizedAt: input.recognizedAt,
          },
          REVENUE_LEDGER_ADMIN_BY_EVENT_LIST_FIELDS,
        ),
        "RevenueLedgerAdminByEventList exposure",
      );
    },

    exposeMany(
      items: readonly RevenueEntryByEventListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const RevenueLedgerAdminMutationExposure =
  Object.freeze({
    expose(
      input: RevenueEntryMutationView,
    ): PlainObject {
      return RevenueLedgerAdminDetailExposure.expose(
        input,
      );
    },
  });
