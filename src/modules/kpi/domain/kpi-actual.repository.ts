import { ClientSession } from "mongodb";
import {
  KpiActualCorrection,
  KpiActualEntry,
  KpiMetricCode,
} from "./kpi.types";

export interface FindKpiActualEntryIdentityInput {
  readonly kpiPlanId: string;
  readonly allocationId: string;
  readonly metricCode: KpiMetricCode;
  readonly actualDate: string;
}

export interface UpdateKpiActualEntryDirectInput {
  readonly actualEntryId: string;
  readonly actualValue: number;
  readonly updatedAt: number;
  readonly updatedByActorId: string;
  readonly maxCurrentEditCountExclusive: number;
}

export interface ApplyKpiActualCorrectionInput {
  readonly correction: KpiActualCorrection;
  readonly updatedAt: number;
  readonly updatedByActorId: string;
}

export interface KpiActualRepository {
  findEntryById(
    actualEntryId: string,
    session?: ClientSession,
  ): Promise<KpiActualEntry | null>;

  findEntryByIdentity(
    input: FindKpiActualEntryIdentityInput,
    session?: ClientSession,
  ): Promise<KpiActualEntry | null>;

  insertEntry(
    entry: KpiActualEntry,
    session: ClientSession,
  ): Promise<KpiActualEntry>;

  updateEntryDirect(
    input: UpdateKpiActualEntryDirectInput,
    session: ClientSession,
  ): Promise<KpiActualEntry | null>;

  insertCorrectionAndApply(
    input: ApplyKpiActualCorrectionInput,
    session: ClientSession,
  ): Promise<KpiActualEntry | null>;

  listEntriesByPlanId(
    kpiPlanId: string,
    session?: ClientSession,
  ): Promise<readonly KpiActualEntry[]>;

  listEntriesByPlanIds(
    kpiPlanIds: readonly string[],
    session?: ClientSession,
  ): Promise<readonly KpiActualEntry[]>;

  listEntriesByPlanIdAndActualDate(
    kpiPlanId: string,
    actualDate: string,
    session?: ClientSession,
  ): Promise<readonly KpiActualEntry[]>;

  listCorrectionsByActualEntryId(
    actualEntryId: string,
    session?: ClientSession,
  ): Promise<readonly KpiActualCorrection[]>;
}
