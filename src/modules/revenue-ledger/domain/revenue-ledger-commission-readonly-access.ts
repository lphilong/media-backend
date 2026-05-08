import { ClientSession } from "mongodb";

export interface RevenueLedgerCommissionFinalizedSettlementReference {
  readonly commissionSettlementId: string;
}

export interface RevenueLedgerCommissionReadonlyAccess {
  findFinalizedSettlementReferenceByRevenueEntryId(
    revenueEntryId: string,
    session?: ClientSession,
  ): Promise<RevenueLedgerCommissionFinalizedSettlementReference | null>;
}
