import { ClientSession } from "mongodb";
import { TalentOperationalStatus } from "@modules/talent/domain/talent.types";

export interface CommissionReferencedTalent {
  readonly id: string;
  readonly operationalStatus: TalentOperationalStatus;
}

export interface CommissionTalentReadonlyAccess {
  findById(
    talentId: string,
    session?: ClientSession,
  ): Promise<CommissionReferencedTalent | null>;
}
