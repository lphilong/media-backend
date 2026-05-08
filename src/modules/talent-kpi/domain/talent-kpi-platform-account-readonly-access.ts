import { ClientSession } from "mongodb";

export interface TalentKpiReferencedPlatformAccount {
  readonly id: string;
}

export interface TalentKpiPlatformAccountReadonlyAccess {
  findById(
    platformAccountId: string,
    session?: ClientSession,
  ): Promise<TalentKpiReferencedPlatformAccount | null>;
}
