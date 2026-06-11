import { ClientSession } from "mongodb";
import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";
import {
  EmploymentTermsAllowance,
  EmploymentTermsPayFrequency,
  EmploymentTermsRecord,
  EmploymentTermsStatus,
} from "./employment-terms.types";

export interface UpdateEmploymentTermsDraftInput {
  readonly id: string;
  readonly employmentProfileId: string;
  readonly effectiveFrom?: number;
  readonly effectiveTo?: number | null;
  readonly baseSalaryAmount?: number;
  readonly currencyCode?: string;
  readonly payFrequency?: EmploymentTermsPayFrequency;
  readonly allowances?: readonly EmploymentTermsAllowance[];
  readonly payrollEligible?: boolean;
  readonly sourceNote?: string | null;
  readonly updatedBy: string;
  readonly updatedAt: number;
}

export interface TransitionEmploymentTermsInput {
  readonly id: string;
  readonly employmentProfileId: string;
  readonly fromStatuses: readonly EmploymentTermsStatus[];
  readonly toStatus: EmploymentTermsStatus;
  readonly updatedBy: string;
  readonly updatedAt: number;
  readonly submittedBy?: string;
  readonly submittedAt?: number;
  readonly approvedBy?: string;
  readonly approvedAt?: number;
  readonly cancelledBy?: string;
  readonly cancelledAt?: number;
}

export interface EmploymentTermsRepository {
  acquireApprovalLock(employmentProfileId: string, session: ClientSession): Promise<void>;
  insert(record: EmploymentTermsRecord, session: ClientSession): Promise<EmploymentTermsRecord>;
  findById(id: string, session?: ClientSession): Promise<EmploymentTermsRecord | null>;
  listByEmploymentProfileId(employmentProfileId: string): Promise<readonly EmploymentTermsRecord[]>;
  updateDraft(input: UpdateEmploymentTermsDraftInput, session: ClientSession): Promise<EmploymentTermsRecord | null>;
  transition(input: TransitionEmploymentTermsInput, session: ClientSession): Promise<EmploymentTermsRecord | null>;
  findOverlappingApprovedPayrollReadable(
    employmentProfileId: string,
    effectiveFrom: number,
    effectiveTo: number | null,
    excludeId?: string,
    session?: ClientSession,
  ): Promise<EmploymentTermsRecord | null>;
  findPayrollReadableForDate(
    employmentProfileId: string,
    date: number,
    session?: ClientSession,
  ): Promise<readonly EmploymentTermsRecord[]>;
  findMaxGeneratedCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
    session?: ClientSession,
  ): Promise<number>;
}
