import { ClientSession } from "mongodb";
import { OrgUnitStatus } from "@modules/org-unit/domain/org-unit.types";

export interface EmploymentProfileReferencedOrgUnit {
  readonly id: string;
  readonly status: OrgUnitStatus;
}

export interface EmploymentProfileOrgUnitReadonlyAccess {
  findById(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<EmploymentProfileReferencedOrgUnit | null>;
}
