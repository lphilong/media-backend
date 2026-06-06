import { ClientSession } from "mongodb";
import {
  OrgUnitStatus,
  OrgUnitType,
} from "@modules/org-unit/domain/org-unit.types";
import { ReferenceSummary } from "@modules/reference-summary";

export interface WorkScheduleReferencedOrgUnit {
  readonly id: string;
  readonly type: OrgUnitType;
  readonly status: OrgUnitStatus;
  readonly ref?: ReferenceSummary;
}

export interface WorkScheduleOrgUnitReadonlyAccess {
  findById(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleReferencedOrgUnit | null>;
}
