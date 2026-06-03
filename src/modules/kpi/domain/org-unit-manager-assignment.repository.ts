import { ClientSession } from "mongodb";
import {
  OrgUnitManagerAssignment,
  OrgUnitManagerRole,
} from "./kpi.types";

export interface OrgUnitManagerAssignmentRepository {
  listActiveByManagerEmploymentProfileId(
    managerEmploymentProfileId: string,
    asOf: number,
    session?: ClientSession,
  ): Promise<readonly OrgUnitManagerAssignment[]>;

  listActiveByManagerEmploymentProfileIdAndRole(
    managerEmploymentProfileId: string,
    role: OrgUnitManagerRole,
    asOf: number,
    session?: ClientSession,
  ): Promise<readonly OrgUnitManagerAssignment[]>;

  listActiveByOrgUnitId(
    orgUnitId: string,
    asOf: number,
    session?: ClientSession,
  ): Promise<readonly OrgUnitManagerAssignment[]>;
}
