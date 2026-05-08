import { ClientSession } from "mongodb";
import { OrgUnitStatus } from "@modules/org-unit/domain/org-unit.types";

export interface PlatformAccountReferencedOrgUnit {
  readonly id: string;
  readonly status: OrgUnitStatus;
}

export interface PlatformAccountOrgUnitReadonlyAccess {
  findById(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<PlatformAccountReferencedOrgUnit | null>;
}
