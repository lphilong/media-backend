import { ClientSession } from "mongodb";
import { TalentGroupStatus } from "@modules/talent-group/domain/talent-group.types";

export interface PlatformAccountReferencedTalentGroup {
  readonly id: string;
  readonly status: TalentGroupStatus;
}

export interface PlatformAccountTalentGroupReadonlyAccess {
  findById(
    groupId: string,
    session?: ClientSession,
  ): Promise<PlatformAccountReferencedTalentGroup | null>;
}
