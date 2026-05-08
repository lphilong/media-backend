import {
  ClientSession,
  Collection,
  Db,
} from "mongodb";
import {
  CommissionContractRegistryReadonlyAccess,
  CommissionReferencedContractRecord,
} from "@modules/commission/domain/commission-contract-registry-readonly-access";
import {
  CommissionEmploymentProfileReadonlyAccess,
  CommissionReferencedEmploymentProfile,
} from "@modules/commission/domain/commission-employment-profile-readonly-access";
import {
  CommissionReferencedRevenueEntry,
  CommissionRevenueLedgerReadonlyAccess,
} from "@modules/commission/domain/commission-revenue-ledger-readonly-access";
import {
  CommissionReferencedTalent,
  CommissionTalentReadonlyAccess,
} from "@modules/commission/domain/commission-talent-readonly-access";
import {
  ContractKind,
  ContractLinkedEntityKind,
  ContractRecordStatus,
} from "@modules/contract-registry/domain/contract-registry.types";
import { EmploymentStatus } from "@modules/employment-profile/domain/employment-profile.types";
import {
  RevenueEntryStatus,
  RevenueKind,
} from "@modules/revenue-ledger/domain/revenue-ledger.types";
import { TalentOperationalStatus } from "@modules/talent/domain/talent.types";

interface EmploymentProfileReferenceDocument {
  readonly _id: string;
  readonly employmentStatus: EmploymentStatus;
}

interface TalentReferenceDocument {
  readonly _id: string;
  readonly operationalStatus: TalentOperationalStatus;
}

interface ContractRecordReferenceDocument {
  readonly _id: string;
  readonly contractKind: ContractKind;
  readonly linkedEntityKind: ContractLinkedEntityKind;
  readonly linkedEmploymentProfileId: string | null;
  readonly linkedTalentId: string | null;
  readonly status: ContractRecordStatus;
  readonly effectiveStartDate: number;
  readonly effectiveEndDate: number | null;
}

interface RevenueEntryReferenceDocument {
  readonly _id: string;
  readonly revenueEntryCode: string;
  readonly status: RevenueEntryStatus;
  readonly subjectTalentId: string;
  readonly revenueKind: RevenueKind;
  readonly currencyCode: string;
  readonly recognizedAmount: number;
  readonly recognizedAt: number;
}

export class NativeMongoCommissionEmploymentProfileReadonlyAccess
  implements CommissionEmploymentProfileReadonlyAccess
{
  private readonly collection: Collection<EmploymentProfileReferenceDocument>;

  constructor(db: Db) {
    this.collection =
      db.collection<EmploymentProfileReferenceDocument>(
        "employment_profiles",
      );
  }

  async findById(
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<CommissionReferencedEmploymentProfile | null> {
    const document = await this.collection.findOne(
      {
        _id: employmentProfileId,
      },
      {
        projection: {
          _id: 1,
          employmentStatus: 1,
        },
        ...(session ? { session } : {}),
      },
    );

    return document
      ? {
          id: document._id,
          employmentStatus:
            document.employmentStatus,
        }
      : null;
  }
}

export class NativeMongoCommissionTalentReadonlyAccess
  implements CommissionTalentReadonlyAccess
{
  private readonly collection: Collection<TalentReferenceDocument>;

  constructor(db: Db) {
    this.collection =
      db.collection<TalentReferenceDocument>(
        "talents",
      );
  }

  async findById(
    talentId: string,
    session?: ClientSession,
  ): Promise<CommissionReferencedTalent | null> {
    const document = await this.collection.findOne(
      {
        _id: talentId,
      },
      {
        projection: {
          _id: 1,
          operationalStatus: 1,
        },
        ...(session ? { session } : {}),
      },
    );

    return document
      ? {
          id: document._id,
          operationalStatus:
            document.operationalStatus,
        }
      : null;
  }
}

export class NativeMongoCommissionContractRegistryReadonlyAccess
  implements CommissionContractRegistryReadonlyAccess
{
  private readonly collection: Collection<ContractRecordReferenceDocument>;

  constructor(db: Db) {
    this.collection =
      db.collection<ContractRecordReferenceDocument>(
        "contract_records",
      );
  }

  async findById(
    contractRecordId: string,
    session?: ClientSession,
  ): Promise<CommissionReferencedContractRecord | null> {
    const document = await this.collection.findOne(
      {
        _id: contractRecordId,
      },
      {
        projection: {
          _id: 1,
          contractKind: 1,
          linkedEntityKind: 1,
          linkedEmploymentProfileId: 1,
          linkedTalentId: 1,
          status: 1,
          effectiveStartDate: 1,
          effectiveEndDate: 1,
        },
        ...(session ? { session } : {}),
      },
    );

    return document
      ? {
          id: document._id,
          contractKind: document.contractKind,
          linkedEntityKind:
            document.linkedEntityKind,
          linkedEmploymentProfileId:
            document.linkedEmploymentProfileId,
          linkedTalentId: document.linkedTalentId,
          status: document.status,
          effectiveStartDate:
            document.effectiveStartDate,
          effectiveEndDate:
            document.effectiveEndDate,
        }
      : null;
  }
}

export class NativeMongoCommissionRevenueLedgerReadonlyAccess
  implements CommissionRevenueLedgerReadonlyAccess
{
  private readonly collection: Collection<RevenueEntryReferenceDocument>;

  constructor(db: Db) {
    this.collection =
      db.collection<RevenueEntryReferenceDocument>(
        "revenue_entries",
      );
  }

  async findByIds(
    revenueEntryIds: readonly string[],
    session?: ClientSession,
  ): Promise<readonly CommissionReferencedRevenueEntry[]> {
    if (revenueEntryIds.length === 0) {
      return [];
    }

    const documents = await this.collection
      .find(
        {
          _id: {
            $in: [...revenueEntryIds],
          },
        },
        {
          projection: {
            _id: 1,
            revenueEntryCode: 1,
            status: 1,
            subjectTalentId: 1,
            revenueKind: 1,
            currencyCode: 1,
            recognizedAmount: 1,
            recognizedAt: 1,
          },
          ...(session ? { session } : {}),
        },
      )
      .toArray();

    return documents.map((document) => ({
      id: document._id,
      revenueEntryCode: document.revenueEntryCode,
      status: document.status,
      subjectTalentId: document.subjectTalentId,
      revenueKind: document.revenueKind,
      currencyCode: document.currencyCode,
      recognizedAmount: document.recognizedAmount,
      recognizedAt: document.recognizedAt,
    }));
  }
}
