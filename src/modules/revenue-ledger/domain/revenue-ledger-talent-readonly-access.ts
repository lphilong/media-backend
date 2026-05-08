import { ClientSession } from "mongodb";

export interface RevenueLedgerReferencedTalent {
  readonly id: string;
}

export interface RevenueLedgerTalentReadonlyAccess {
  findById(
    talentId: string,
    session?: ClientSession,
  ): Promise<RevenueLedgerReferencedTalent | null>;
}
