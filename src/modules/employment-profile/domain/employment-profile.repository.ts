import { ClientSession } from "mongodb";
import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";
import {
  EmploymentContractStatus,
  EmploymentKind,
  EmploymentProfileRecord,
  EmploymentStatus,
} from "./employment-profile.types";

export interface UpdateEmploymentProfileCoreInput {
  readonly employmentProfileId: string;
  readonly legalName?: string;
  readonly normalizedLegalName?: string;
  readonly displayName?: string;
  readonly normalizedDisplayName?: string;
  readonly employmentKind?: EmploymentKind;
  readonly jobTitle?: string;
  readonly titleDescription?: string | null;
  readonly externalRef?: string | null;
  readonly recruiterEmploymentProfileId?: string | null;
  readonly hrOwnerEmploymentProfileId?: string | null;
  readonly onboardingOwnerEmploymentProfileId?: string | null;
  readonly sourcedByEmploymentProfileId?: string | null;
  readonly hiredAt?: number | null;
  readonly onboardedAt?: number | null;
  readonly updatedAt: number;
}

export interface AssignEmploymentProfileOrgUnitInput {
  readonly employmentProfileId: string;
  readonly orgUnitId: string;
  readonly updatedAt: number;
}

export interface AssignEmploymentProfileManagerInput {
  readonly employmentProfileId: string;
  readonly managerEmploymentProfileId: string | null;
  readonly updatedAt: number;
}

export interface SetEmploymentProfileLinkedUserInput {
  readonly employmentProfileId: string;
  readonly linkedUserId: string | null;
  readonly updatedAt: number;
}

export interface TransitionEmploymentProfileLifecycleInput {
  readonly employmentProfileId: string;
  readonly fromStatuses: readonly EmploymentStatus[];
  readonly toStatus: EmploymentStatus;
  readonly contractStatus?: EmploymentContractStatus;
  readonly employmentEndDate?: number | null;
  readonly updatedAt: number;
}

export interface UpdateEmploymentProfileContractStatusInput {
  readonly employmentProfileId: string;
  readonly contractStatus: EmploymentContractStatus;
  readonly updatedAt: number;
}

export interface EmploymentProfileRepository {
  insert(
    employmentProfile: EmploymentProfileRecord,
    session: ClientSession,
  ): Promise<EmploymentProfileRecord>;

  findById(
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<EmploymentProfileRecord | null>;

  findByEmployeeCode(
    employeeCode: string,
    session?: ClientSession,
  ): Promise<EmploymentProfileRecord | null>;

  findMaxGeneratedCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
    session?: ClientSession,
  ): Promise<number>;

  findNonArchivedByLinkedUserId(
    linkedUserId: string,
    session?: ClientSession,
  ): Promise<EmploymentProfileRecord | null>;

  updateCore(
    input: UpdateEmploymentProfileCoreInput,
    session: ClientSession,
  ): Promise<EmploymentProfileRecord | null>;

  assignOrgUnit(
    input: AssignEmploymentProfileOrgUnitInput,
    session: ClientSession,
  ): Promise<EmploymentProfileRecord | null>;

  assignManager(
    input: AssignEmploymentProfileManagerInput,
    session: ClientSession,
  ): Promise<EmploymentProfileRecord | null>;

  setLinkedUser(
    input: SetEmploymentProfileLinkedUserInput,
    session: ClientSession,
  ): Promise<EmploymentProfileRecord | null>;

  transitionLifecycle(
    input: TransitionEmploymentProfileLifecycleInput,
    session: ClientSession,
  ): Promise<EmploymentProfileRecord | null>;

  updateContractStatus(
    input: UpdateEmploymentProfileContractStatusInput,
    session: ClientSession,
  ): Promise<EmploymentProfileRecord | null>;

  hasNonArchivedDirectReports(
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<boolean>;
}
