import {
  PlainObject,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { ExposurePolicy } from "@core/exposure/exposure.policy";
import {
  TalentKpiByEventListItemView,
  TalentKpiByPlatformListItemView,
  TalentKpiByTalentListItemView,
  TalentKpiMetricValueListItemView,
  TalentKpiRecordDetailView,
  TalentKpiRecordListItemView,
  TalentKpiRecordMutationView,
} from "@modules/talent-kpi/domain/talent-kpi.types";

const TALENT_KPI_ADMIN_DETAIL_FIELDS = [
  "id",
  "kpiRecordCode",
  "title",
  "subjectTalentId",
  "attributionPlatformAccountId",
  "attributionEventId",
  "subjectTalentRef",
  "attributionPlatformAccountRef",
  "attributionEventRef",
  "measurementSource",
  "status",
  "periodStartAt",
  "periodEndAt",
  "publishedAt",
  "description",
  "externalRef",
  "createdAt",
  "updatedAt",
] as const;

const TALENT_KPI_ADMIN_LIST_FIELDS = [
  "id",
  "kpiRecordCode",
  "title",
  "subjectTalentId",
  "attributionPlatformAccountId",
  "attributionEventId",
  "subjectTalentRef",
  "attributionPlatformAccountRef",
  "attributionEventRef",
  "measurementSource",
  "status",
  "periodStartAt",
  "periodEndAt",
  "publishedAt",
  "createdAt",
] as const;

const TALENT_KPI_ADMIN_METRIC_LIST_FIELDS = [
  "id",
  "metricCode",
  "numericValue",
  "createdAt",
  "updatedAt",
] as const;

const TALENT_KPI_ADMIN_BY_TALENT_LIST_FIELDS = [
  "id",
  "kpiRecordCode",
  "title",
  "subjectTalentId",
  "status",
  "measurementSource",
  "periodStartAt",
  "periodEndAt",
  "publishedAt",
] as const;

const TALENT_KPI_ADMIN_BY_PLATFORM_LIST_FIELDS = [
  "id",
  "kpiRecordCode",
  "title",
  "subjectTalentId",
  "attributionPlatformAccountId",
  "status",
  "periodStartAt",
  "periodEndAt",
] as const;

const TALENT_KPI_ADMIN_BY_EVENT_LIST_FIELDS = [
  "id",
  "kpiRecordCode",
  "title",
  "subjectTalentId",
  "attributionEventId",
  "status",
  "periodStartAt",
  "periodEndAt",
] as const;

export const TalentKpiAdminDetailExposure =
  Object.freeze({
    expose(
      input: TalentKpiRecordDetailView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            kpiRecordCode: input.kpiRecordCode,
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
            measurementSource:
              input.measurementSource,
            status: input.status,
            periodStartAt: input.periodStartAt,
            periodEndAt: input.periodEndAt,
            publishedAt: input.publishedAt,
            description: input.description,
            externalRef: input.externalRef,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          TALENT_KPI_ADMIN_DETAIL_FIELDS,
        ),
        "TalentKpiAdminDetail exposure",
      );
    },
  });

export const TalentKpiAdminListExposure =
  Object.freeze({
    expose(
      input: TalentKpiRecordListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            kpiRecordCode: input.kpiRecordCode,
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
            measurementSource:
              input.measurementSource,
            status: input.status,
            periodStartAt: input.periodStartAt,
            periodEndAt: input.periodEndAt,
            publishedAt: input.publishedAt,
            createdAt: input.createdAt,
          },
          TALENT_KPI_ADMIN_LIST_FIELDS,
        ),
        "TalentKpiAdminList exposure",
      );
    },

    exposeMany(
      items: readonly TalentKpiRecordListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const TalentKpiAdminMetricListExposure =
  Object.freeze({
    expose(
      input: TalentKpiMetricValueListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            metricCode: input.metricCode,
            numericValue: input.numericValue,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          TALENT_KPI_ADMIN_METRIC_LIST_FIELDS,
        ),
        "TalentKpiAdminMetricList exposure",
      );
    },

    exposeMany(
      items: readonly TalentKpiMetricValueListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const TalentKpiAdminByTalentListExposure =
  Object.freeze({
    expose(
      input: TalentKpiByTalentListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            kpiRecordCode: input.kpiRecordCode,
            title: input.title,
            subjectTalentId: input.subjectTalentId,
            status: input.status,
            measurementSource:
              input.measurementSource,
            periodStartAt: input.periodStartAt,
            periodEndAt: input.periodEndAt,
            publishedAt: input.publishedAt,
          },
          TALENT_KPI_ADMIN_BY_TALENT_LIST_FIELDS,
        ),
        "TalentKpiAdminByTalentList exposure",
      );
    },

    exposeMany(
      items: readonly TalentKpiByTalentListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const TalentKpiAdminByPlatformListExposure =
  Object.freeze({
    expose(
      input: TalentKpiByPlatformListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            kpiRecordCode: input.kpiRecordCode,
            title: input.title,
            subjectTalentId: input.subjectTalentId,
            attributionPlatformAccountId:
              input.attributionPlatformAccountId,
            status: input.status,
            periodStartAt: input.periodStartAt,
            periodEndAt: input.periodEndAt,
          },
          TALENT_KPI_ADMIN_BY_PLATFORM_LIST_FIELDS,
        ),
        "TalentKpiAdminByPlatformList exposure",
      );
    },

    exposeMany(
      items: readonly TalentKpiByPlatformListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const TalentKpiAdminByEventListExposure =
  Object.freeze({
    expose(
      input: TalentKpiByEventListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            kpiRecordCode: input.kpiRecordCode,
            title: input.title,
            subjectTalentId: input.subjectTalentId,
            attributionEventId:
              input.attributionEventId,
            status: input.status,
            periodStartAt: input.periodStartAt,
            periodEndAt: input.periodEndAt,
          },
          TALENT_KPI_ADMIN_BY_EVENT_LIST_FIELDS,
        ),
        "TalentKpiAdminByEventList exposure",
      );
    },

    exposeMany(
      items: readonly TalentKpiByEventListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const TalentKpiAdminMutationExposure =
  Object.freeze({
    expose(
      input: TalentKpiRecordMutationView,
    ): PlainObject {
      return TalentKpiAdminDetailExposure.expose(
        input,
      );
    },
  });
