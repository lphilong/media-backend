import { ClientSession } from "mongodb";
import {
  OrgUnitStatus,
  OrgUnitType,
} from "@modules/org-unit/domain/org-unit.types";

export interface WorkScheduleReferencedOrgUnit {
  readonly id: string;
  readonly type: OrgUnitType;
  readonly status: OrgUnitStatus;
}

export interface WorkScheduleOrgUnitReadonlyAccess {
  findById(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleReferencedOrgUnit | null>;
}
