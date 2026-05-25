import { EmploymentStatus } from "@modules/employment-profile/domain/employment-profile.types";
import { UserAccountStatus } from "@modules/user/domain/user.types";

export interface SelfServiceLinkedInternalTalentSummary {
  readonly talentId: string;
  readonly talentCode: string;
  readonly displayName: string;
  readonly performanceAlias: string | null;
}

export interface SelfServiceCurrentPersonView {
  readonly employmentProfileId: string;
  readonly employeeCode: string;
  readonly displayName: string;
  readonly employmentStatus: EmploymentStatus;
  readonly accountEmail?: string;
  readonly accountStatus?: UserAccountStatus;
  readonly accountLinkStatus: "LINKED";
  readonly linkedInternalTalent?: SelfServiceLinkedInternalTalentSummary;
  readonly locale?: string;
  readonly timezone?: string;
}
