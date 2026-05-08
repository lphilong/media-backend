import { ClientSession } from "mongodb";

export interface RevenueLedgerReferencedPlatformAccount {
  readonly id: string;
}

export interface RevenueLedgerPlatformAccountReadonlyAccess {
  findById(
    platformAccountId: string,
    session?: ClientSession,
  ): Promise<RevenueLedgerReferencedPlatformAccount | null>;
}
