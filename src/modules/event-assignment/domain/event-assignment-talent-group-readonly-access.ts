import { ClientSession } from "mongodb";
import { TalentGroupStatus } from "@modules/talent-group/domain/talent-group.types";

export interface EventAssignmentReferencedTalentGroup {
  readonly id: string;
  readonly status: TalentGroupStatus;
}

export interface EventAssignmentTalentGroupReadonlyAccess {
  findById(
    talentGroupId: string,
    session?: ClientSession,
  ): Promise<EventAssignmentReferencedTalentGroup | null>;
}
