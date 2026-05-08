import { ClientSession } from "mongodb";
import {
  TalentKpiMeasurementSource,
  TalentKpiMetricValue,
  TalentKpiRecord,
  TalentKpiRecordStatus,
} from "./talent-kpi.types";

export interface TalentKpiMeasurementIdentity {
  readonly subjectTalentId: string;
  readonly attributionPlatformAccountId: string | null;
  readonly attributionEventId: string | null;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly measurementSource: TalentKpiMeasurementSource;
}

export interface FindNonArchivedByMeasurementIdentityInput
  extends TalentKpiMeasurementIdentity {
  readonly excludeTalentKpiRecordId?: string;
}

export interface UpdateTalentKpiDraftCoreInput {
  readonly talentKpiRecordId: string;
  readonly title?: string;
  readonly normalizedTitle?: string;
  readonly subjectTalentId?: string;
  readonly attributionPlatformAccountId?: string | null;
  readonly attributionEventId?: string | null;
  readonly periodStartAt?: number;
  readonly periodEndAt?: number;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly updatedAt: number;
}

export interface TouchTalentKpiDraftInput {
  readonly talentKpiRecordId: string;
  readonly updatedAt: number;
}

export interface TransitionTalentKpiStatusInput {
  readonly talentKpiRecordId: string;
  readonly fromStatuses: readonly TalentKpiRecordStatus[];
  readonly toStatus: TalentKpiRecordStatus;
  readonly publishedAt?: number | null;
  readonly updatedAt: number;
}

export interface TalentKpiRepository {
  insertRecord(
    record: TalentKpiRecord,
    session: ClientSession,
  ): Promise<TalentKpiRecord>;

  insertMetricValues(
    metricValues: readonly TalentKpiMetricValue[],
    session: ClientSession,
  ): Promise<readonly TalentKpiMetricValue[]>;

  findRecordById(
    talentKpiRecordId: string,
    session?: ClientSession,
  ): Promise<TalentKpiRecord | null>;

  findRecordByKpiRecordCode(
    kpiRecordCode: string,
    session?: ClientSession,
  ): Promise<TalentKpiRecord | null>;

  findNonArchivedByMeasurementIdentity(
    input: FindNonArchivedByMeasurementIdentityInput,
    session?: ClientSession,
  ): Promise<TalentKpiRecord | null>;

  updateDraftCore(
    input: UpdateTalentKpiDraftCoreInput,
    session: ClientSession,
  ): Promise<TalentKpiRecord | null>;

  touchDraftRecord(
    input: TouchTalentKpiDraftInput,
    session: ClientSession,
  ): Promise<TalentKpiRecord | null>;

  transitionStatus(
    input: TransitionTalentKpiStatusInput,
    session: ClientSession,
  ): Promise<TalentKpiRecord | null>;

  listMetricValuesByRecordId(
    talentKpiRecordId: string,
    session?: ClientSession,
  ): Promise<readonly TalentKpiMetricValue[]>;

  deleteMetricValuesByRecordId(
    talentKpiRecordId: string,
    session: ClientSession,
  ): Promise<void>;
}
