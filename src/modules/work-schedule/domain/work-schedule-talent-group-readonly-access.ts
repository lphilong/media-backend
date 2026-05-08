import { ClientSession } from "mongodb";
import { TalentGroupStatus } from "@modules/talent-group/domain/talent-group.types";

export interface WorkScheduleReferencedTalentGroup {
  readonly id: string;
  readonly status: TalentGroupStatus;
}

export interface WorkScheduleTalentGroupReadonlyAccess {
  findById(
    talentGroupId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleReferencedTalentGroup | null>;
}
