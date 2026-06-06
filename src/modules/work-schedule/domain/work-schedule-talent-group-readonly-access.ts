import { ClientSession } from "mongodb";
import { TalentGroupStatus } from "@modules/talent-group/domain/talent-group.types";
import { ReferenceSummary } from "@modules/reference-summary";

export interface WorkScheduleReferencedTalentGroup {
  readonly id: string;
  readonly status: TalentGroupStatus;
  readonly ref?: ReferenceSummary;
}

export interface WorkScheduleTalentGroupReadonlyAccess {
  findById(
    talentGroupId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleReferencedTalentGroup | null>;
}
