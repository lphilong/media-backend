import { ClientSession } from "mongodb";
import { TalentOperationalStatus } from "@modules/talent/domain/talent.types";

export interface ContractRegistryReferencedTalent {
  readonly id: string;
  readonly operationalStatus: TalentOperationalStatus;
}

export interface ContractRegistryTalentReadonlyAccess {
  findById(
    talentId: string,
    session?: ClientSession,
  ): Promise<ContractRegistryReferencedTalent | null>;
}
