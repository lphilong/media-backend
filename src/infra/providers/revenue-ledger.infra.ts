import { Db } from "mongodb";
import { NativeMongoRevenueLedgerReadRepository } from "@infra/mongo/revenue-ledger/revenue-ledger.read-repository";
import {
  NativeMongoRevenueLedgerCommissionReadonlyAccess,
  NativeMongoRevenueLedgerEventReadonlyAccess,
  NativeMongoRevenueLedgerPlatformAccountReadonlyAccess,
  NativeMongoRevenueLedgerTalentReadonlyAccess,
} from "@infra/mongo/revenue-ledger/revenue-ledger.readonly-access";
import { NativeMongoRevenueEntryRepository } from "@infra/mongo/revenue-ledger/revenue-ledger.repository";

export interface RevenueLedgerInfra {
  readonly revenueEntryRepository: NativeMongoRevenueEntryRepository;
  readonly revenueLedgerReadRepository: NativeMongoRevenueLedgerReadRepository;
  readonly revenueLedgerTalentReadonlyAccess: NativeMongoRevenueLedgerTalentReadonlyAccess;
  readonly revenueLedgerPlatformAccountReadonlyAccess: NativeMongoRevenueLedgerPlatformAccountReadonlyAccess;
  readonly revenueLedgerEventReadonlyAccess: NativeMongoRevenueLedgerEventReadonlyAccess;
  readonly revenueLedgerCommissionReadonlyAccess: NativeMongoRevenueLedgerCommissionReadonlyAccess;
}

export function createRevenueLedgerInfra(
  db: Db,
): RevenueLedgerInfra {
  return {
    revenueEntryRepository:
      new NativeMongoRevenueEntryRepository(db),
    revenueLedgerReadRepository:
      new NativeMongoRevenueLedgerReadRepository(
        db,
      ),
    revenueLedgerTalentReadonlyAccess:
      new NativeMongoRevenueLedgerTalentReadonlyAccess(
        db,
      ),
    revenueLedgerPlatformAccountReadonlyAccess:
      new NativeMongoRevenueLedgerPlatformAccountReadonlyAccess(
        db,
      ),
    revenueLedgerEventReadonlyAccess:
      new NativeMongoRevenueLedgerEventReadonlyAccess(
        db,
      ),
    revenueLedgerCommissionReadonlyAccess:
      new NativeMongoRevenueLedgerCommissionReadonlyAccess(
        db,
      ),
  };
}
