import { ClientSession } from "mongodb";
import {
  RevenueEntryStatus,
  RevenueKind,
} from "@modules/revenue-ledger/domain/revenue-ledger.types";

export interface CommissionReferencedRevenueEntry {
  readonly id: string;
  readonly revenueEntryCode: string;
  readonly status: RevenueEntryStatus;
  readonly subjectTalentId: string;
  readonly revenueKind: RevenueKind;
  readonly currencyCode: string;
  readonly recognizedAmount: number;
  readonly recognizedAt: number;
}

export interface CommissionRevenueLedgerReadonlyAccess {
  findByIds(
    revenueEntryIds: readonly string[],
    session?: ClientSession,
  ): Promise<readonly CommissionReferencedRevenueEntry[]>;
}
