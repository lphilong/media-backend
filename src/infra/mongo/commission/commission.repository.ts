import {
  ClientSession,
  Collection,
  Db,
} from "mongodb";
import {
  buildGeneratedBusinessCodeRegex,
  BusinessCodePolicy,
  parseGeneratedBusinessCodeSequence,
} from "@core/business-code/business-code-sequence.repository";
import { BaseRepository } from "@infra/database/repository/base.repository";
import {
  CommissionRepository,
  SettlementExclusivityConflictProbeInput,
  SettlementExclusivityConflictProbeResult,
  TouchCommissionSettlementDraftInput,
  TransitionCommissionRuleStatusInput,
  TransitionCommissionSettlementStatusInput,
  UpdateCommissionRuleDraftCoreInput,
  UpdateCommissionSettlementDraftCoreInput,
  UpdateCommissionSettlementDraftDerivedInput,
} from "@modules/commission/domain/commission.repository";
import {
  CommissionBeneficiaryKind,
  CommissionRule,
  CommissionRuleStatus,
  CommissionSettlement,
  CommissionSettlementBasis,
  CommissionSettlementKind,
  CommissionSettlementLine,
  CommissionSettlementStatus,
} from "@modules/commission/domain/commission.types";
import { RevenueKind } from "@modules/revenue-ledger/domain/revenue-ledger.types";

interface CommissionRuleDocument {
  readonly _id: string;
  readonly ruleCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly settlementKind: CommissionSettlementKind;
  readonly beneficiaryKind: CommissionBeneficiaryKind;
  readonly beneficiaryEmploymentProfileId: string | null;
  readonly beneficiaryTalentId: string | null;
  readonly sourceContractRecordId: string;
  readonly settlementBasis: CommissionSettlementBasis;
  readonly ratePercent: number;
  readonly appliesToRevenueKinds: readonly RevenueKind[];
  readonly status: CommissionRuleStatus;
  readonly effectiveStartDate: number;
  readonly effectiveEndDate: number | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface CommissionSettlementDocument {
  readonly _id: string;
  readonly settlementCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly sourceRuleId: string;
  readonly sourceContractRecordIdSnapshot: string;
  readonly settlementKindSnapshot: CommissionSettlementKind;
  readonly beneficiaryKindSnapshot: CommissionBeneficiaryKind;
  readonly beneficiaryEmploymentProfileIdSnapshot: string | null;
  readonly beneficiaryTalentIdSnapshot: string | null;
  readonly subjectTalentId: string;
  readonly settlementBasisSnapshot: CommissionSettlementBasis;
  readonly ratePercentSnapshot: number;
  readonly revenueEntryIds: readonly string[];
  readonly settlementPeriodStartAt: number;
  readonly settlementPeriodEndAt: number;
  readonly settlementCurrencyCode: string;
  readonly grossRevenueAmount: number;
  readonly settlementAmount: number;
  readonly status: CommissionSettlementStatus;
  readonly finalizedAt: number | null;
  readonly voidedAt: number | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface CommissionSettlementLineDocument {
  readonly _id: string;
  readonly settlementId: string;
  readonly revenueEntryId: string;
  readonly revenueEntryCodeSnapshot: string;
  readonly revenueKindSnapshot: RevenueKind;
  readonly revenueCurrencyCodeSnapshot: string;
  readonly revenueRecognizedAmountSnapshot: number;
  readonly revenueRecognizedAtSnapshot: number;
  readonly lineSettlementAmount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export class NativeMongoCommissionRepository
  extends BaseRepository<CommissionRuleDocument>
  implements CommissionRepository
{
  private readonly settlementCollection: Collection<CommissionSettlementDocument>;
  private readonly settlementLineCollection: Collection<CommissionSettlementLineDocument>;

  constructor(db: Db) {
    super(db, "commission_rules");
    this.settlementCollection =
      db.collection<CommissionSettlementDocument>(
        "commission_settlements",
      );
    this.settlementLineCollection =
      db.collection<CommissionSettlementLineDocument>(
        "commission_settlement_lines",
      );
  }

  async insertRule(
    rule: CommissionRule,
    session: ClientSession,
  ): Promise<CommissionRule> {
    await this.collection.insertOne(
      toCommissionRuleDocument(rule),
      this.withSession(session),
    );

    return rule;
  }

  async findRuleById(
    commissionRuleId: string,
    session?: ClientSession,
  ): Promise<CommissionRule | null> {
    const document = await this.collection.findOne(
      {
        _id: commissionRuleId,
      },
      this.withSession(session),
    );

    return document
      ? toCommissionRule(document)
      : null;
  }

  async findRuleByRuleCode(
    ruleCode: string,
    session?: ClientSession,
  ): Promise<CommissionRule | null> {
    const document = await this.collection.findOne(
      {
        ruleCode,
      },
      this.withSession(session),
    );

    return document
      ? toCommissionRule(document)
      : null;
  }

  async findMaxGeneratedRuleCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
    session?: ClientSession,
  ): Promise<number> {
    const document = await this.collection
      .find(
        {
          ruleCode:
            buildGeneratedBusinessCodeRegex(policy),
        },
        this.withSession(session),
      )
      .sort({ ruleCode: -1 })
      .limit(1)
      .next();

    if (!document) {
      return 0;
    }

    return (
      parseGeneratedBusinessCodeSequence(
        document.ruleCode,
        policy,
      ) ?? 0
    );
  }

  async updateRuleDraftCore(
    input: UpdateCommissionRuleDraftCoreInput,
    session: ClientSession,
  ): Promise<CommissionRule | null> {
    const set: Record<string, unknown> = {
      updatedAt: input.updatedAt,
    };

    if (input.title !== undefined) {
      set.title = input.title;
    }

    if (input.normalizedTitle !== undefined) {
      set.normalizedTitle = input.normalizedTitle;
    }

    if (input.ratePercent !== undefined) {
      set.ratePercent = input.ratePercent;
    }

    if (input.appliesToRevenueKinds !== undefined) {
      set.appliesToRevenueKinds =
        input.appliesToRevenueKinds;
    }

    if (input.effectiveStartDate !== undefined) {
      set.effectiveStartDate =
        input.effectiveStartDate;
    }

    if (input.effectiveEndDate !== undefined) {
      set.effectiveEndDate = input.effectiveEndDate;
    }

    if (input.description !== undefined) {
      set.description = input.description;
    }

    if (input.externalRef !== undefined) {
      set.externalRef = input.externalRef;
    }

    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.commissionRuleId,
        status: {
          $in: ["DRAFT", "INACTIVE"],
        },
      },
      {
        $set: set,
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toCommissionRule(updated) : null;
  }

  async transitionRuleStatus(
    input: TransitionCommissionRuleStatusInput,
    session: ClientSession,
  ): Promise<CommissionRule | null> {
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.commissionRuleId,
        status: {
          $in: [...input.fromStatuses],
        },
      },
      {
        $set: {
          status: input.toStatus,
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toCommissionRule(updated) : null;
  }

  async insertSettlement(
    settlement: CommissionSettlement,
    session: ClientSession,
  ): Promise<CommissionSettlement> {
    await this.settlementCollection.insertOne(
      toCommissionSettlementDocument(settlement),
      this.withSession(session),
    );

    return settlement;
  }

  async findSettlementById(
    commissionSettlementId: string,
    session?: ClientSession,
  ): Promise<CommissionSettlement | null> {
    const document =
      await this.settlementCollection.findOne(
        {
          _id: commissionSettlementId,
        },
        this.withSession(session),
      );

    return document
      ? toCommissionSettlement(document)
      : null;
  }

  async findSettlementBySettlementCode(
    settlementCode: string,
    session?: ClientSession,
  ): Promise<CommissionSettlement | null> {
    const document =
      await this.settlementCollection.findOne(
        {
          settlementCode,
        },
        this.withSession(session),
      );

    return document
      ? toCommissionSettlement(document)
      : null;
  }

  async findMaxGeneratedSettlementCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
    session?: ClientSession,
  ): Promise<number> {
    const document = await this.settlementCollection
      .find(
        {
          settlementCode:
            buildGeneratedBusinessCodeRegex(policy),
        },
        this.withSession(session),
      )
      .sort({ settlementCode: -1 })
      .limit(1)
      .next();

    if (!document) {
      return 0;
    }

    return (
      parseGeneratedBusinessCodeSequence(
        document.settlementCode,
        policy,
      ) ?? 0
    );
  }

  async updateSettlementDraftCore(
    input: UpdateCommissionSettlementDraftCoreInput,
    session: ClientSession,
  ): Promise<CommissionSettlement | null> {
    const set: Record<string, unknown> = {
      updatedAt: input.updatedAt,
    };

    if (input.title !== undefined) {
      set.title = input.title;
    }

    if (input.normalizedTitle !== undefined) {
      set.normalizedTitle = input.normalizedTitle;
    }

    if (input.settlementPeriodStartAt !== undefined) {
      set.settlementPeriodStartAt =
        input.settlementPeriodStartAt;
    }

    if (input.settlementPeriodEndAt !== undefined) {
      set.settlementPeriodEndAt =
        input.settlementPeriodEndAt;
    }

    if (input.description !== undefined) {
      set.description = input.description;
    }

    if (input.externalRef !== undefined) {
      set.externalRef = input.externalRef;
    }

    const updated =
      await this.settlementCollection.findOneAndUpdate(
        {
          _id: input.commissionSettlementId,
          status: "DRAFT",
        },
        {
          $set: set,
        },
        {
          ...this.withSession(session),
          returnDocument: "after",
        },
      );

    return updated
      ? toCommissionSettlement(updated)
      : null;
  }

  async updateSettlementDraftDerived(
    input: UpdateCommissionSettlementDraftDerivedInput,
    session: ClientSession,
  ): Promise<CommissionSettlement | null> {
    const updated =
      await this.settlementCollection.findOneAndUpdate(
        {
          _id: input.commissionSettlementId,
          status: "DRAFT",
        },
        {
          $set: {
            revenueEntryIds: [...input.revenueEntryIds],
            subjectTalentId: input.subjectTalentId,
            settlementCurrencyCode:
              input.settlementCurrencyCode,
            grossRevenueAmount:
              input.grossRevenueAmount,
            settlementAmount: input.settlementAmount,
            updatedAt: input.updatedAt,
          },
        },
        {
          ...this.withSession(session),
          returnDocument: "after",
        },
      );

    return updated
      ? toCommissionSettlement(updated)
      : null;
  }

  async touchSettlementDraft(
    input: TouchCommissionSettlementDraftInput,
    session: ClientSession,
  ): Promise<CommissionSettlement | null> {
    const updated =
      await this.settlementCollection.findOneAndUpdate(
        {
          _id: input.commissionSettlementId,
          status: "DRAFT",
        },
        {
          $set: {
            updatedAt: input.updatedAt,
          },
        },
        {
          ...this.withSession(session),
          returnDocument: "after",
        },
      );

    return updated
      ? toCommissionSettlement(updated)
      : null;
  }

  async transitionSettlementStatus(
    input: TransitionCommissionSettlementStatusInput,
    session: ClientSession,
  ): Promise<CommissionSettlement | null> {
    const set: Record<string, unknown> = {
      status: input.toStatus,
      updatedAt: input.updatedAt,
    };

    if (input.finalizedAt !== undefined) {
      set.finalizedAt = input.finalizedAt;
    }

    if (input.voidedAt !== undefined) {
      set.voidedAt = input.voidedAt;
    }

    const updated =
      await this.settlementCollection.findOneAndUpdate(
        {
          _id: input.commissionSettlementId,
          status: {
            $in: [...input.fromStatuses],
          },
        },
        {
          $set: set,
        },
        {
          ...this.withSession(session),
          returnDocument: "after",
        },
      );

    return updated
      ? toCommissionSettlement(updated)
      : null;
  }

  async insertSettlementLines(
    lines: readonly CommissionSettlementLine[],
    session: ClientSession,
  ): Promise<readonly CommissionSettlementLine[]> {
    if (lines.length === 0) {
      return [];
    }

    await this.settlementLineCollection.insertMany(
      lines.map(toCommissionSettlementLineDocument),
      this.withSession(session),
    );

    return lines;
  }

  async listSettlementLinesBySettlementId(
    commissionSettlementId: string,
    session?: ClientSession,
  ): Promise<readonly CommissionSettlementLine[]> {
    const documents =
      await this.settlementLineCollection
        .find(
          {
            settlementId: commissionSettlementId,
          },
          this.withSession(session),
        )
        .sort({
          revenueEntryId: 1,
          _id: 1,
        })
        .toArray();

    return documents.map(toCommissionSettlementLine);
  }

  async deleteSettlementLinesBySettlementId(
    commissionSettlementId: string,
    session: ClientSession,
  ): Promise<void> {
    await this.settlementLineCollection.deleteMany(
      {
        settlementId: commissionSettlementId,
      },
      this.withSession(session),
    );
  }

  async findSettlementExclusivityConflict(
    input: SettlementExclusivityConflictProbeInput,
    session?: ClientSession,
  ): Promise<SettlementExclusivityConflictProbeResult | null> {
    if (input.revenueEntryIds.length === 0) {
      return null;
    }

    const query: Record<string, unknown> = {
      status: {
        $nin: ["VOIDED", "ARCHIVED"],
      },
      beneficiaryKindSnapshot:
        input.beneficiaryKindSnapshot,
      beneficiaryEmploymentProfileIdSnapshot:
        input.beneficiaryEmploymentProfileIdSnapshot,
      beneficiaryTalentIdSnapshot:
        input.beneficiaryTalentIdSnapshot,
      revenueEntryIds: {
        $in: [...input.revenueEntryIds],
      },
    };

    if (input.excludeCommissionSettlementId) {
      query._id = {
        $ne: input.excludeCommissionSettlementId,
      };
    }

    const document =
      await this.settlementCollection.findOne(
        query,
        {
          projection: {
            _id: 1,
            revenueEntryIds: 1,
          },
          ...(session ? { session } : {}),
        },
      );

    if (!document) {
      return null;
    }

    const probedSet = new Set(input.revenueEntryIds);
    const conflictingRevenueEntryId =
      document.revenueEntryIds.find((value) =>
        probedSet.has(value),
      );

    if (!conflictingRevenueEntryId) {
      return null;
    }

    return {
      settlementId: document._id,
      conflictingRevenueEntryId,
    };
  }
}

function toCommissionRuleDocument(
  input: CommissionRule,
): CommissionRuleDocument {
  return {
    _id: input.id,
    ruleCode: input.ruleCode,
    title: input.title,
    normalizedTitle: input.normalizedTitle,
    settlementKind: input.settlementKind,
    beneficiaryKind: input.beneficiaryKind,
    beneficiaryEmploymentProfileId:
      input.beneficiaryEmploymentProfileId,
    beneficiaryTalentId: input.beneficiaryTalentId,
    sourceContractRecordId: input.sourceContractRecordId,
    settlementBasis: input.settlementBasis,
    ratePercent: input.ratePercent,
    appliesToRevenueKinds: [
      ...input.appliesToRevenueKinds,
    ],
    status: input.status,
    effectiveStartDate: input.effectiveStartDate,
    effectiveEndDate: input.effectiveEndDate,
    description: input.description,
    externalRef: input.externalRef,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function toCommissionRule(
  document: CommissionRuleDocument,
): CommissionRule {
  return {
    id: document._id,
    ruleCode: document.ruleCode,
    title: document.title,
    normalizedTitle: document.normalizedTitle,
    settlementKind: document.settlementKind,
    beneficiaryKind: document.beneficiaryKind,
    beneficiaryEmploymentProfileId:
      document.beneficiaryEmploymentProfileId,
    beneficiaryTalentId: document.beneficiaryTalentId,
    sourceContractRecordId: document.sourceContractRecordId,
    settlementBasis: document.settlementBasis,
    ratePercent: document.ratePercent,
    appliesToRevenueKinds: [
      ...document.appliesToRevenueKinds,
    ],
    status: document.status,
    effectiveStartDate: document.effectiveStartDate,
    effectiveEndDate: document.effectiveEndDate,
    description: document.description,
    externalRef: document.externalRef,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function toCommissionSettlementDocument(
  input: CommissionSettlement,
): CommissionSettlementDocument {
  return {
    _id: input.id,
    settlementCode: input.settlementCode,
    title: input.title,
    normalizedTitle: input.normalizedTitle,
    sourceRuleId: input.sourceRuleId,
    sourceContractRecordIdSnapshot:
      input.sourceContractRecordIdSnapshot,
    settlementKindSnapshot:
      input.settlementKindSnapshot,
    beneficiaryKindSnapshot:
      input.beneficiaryKindSnapshot,
    beneficiaryEmploymentProfileIdSnapshot:
      input.beneficiaryEmploymentProfileIdSnapshot,
    beneficiaryTalentIdSnapshot:
      input.beneficiaryTalentIdSnapshot,
    subjectTalentId: input.subjectTalentId,
    settlementBasisSnapshot:
      input.settlementBasisSnapshot,
    ratePercentSnapshot: input.ratePercentSnapshot,
    revenueEntryIds: [...input.revenueEntryIds],
    settlementPeriodStartAt:
      input.settlementPeriodStartAt,
    settlementPeriodEndAt:
      input.settlementPeriodEndAt,
    settlementCurrencyCode:
      input.settlementCurrencyCode,
    grossRevenueAmount: input.grossRevenueAmount,
    settlementAmount: input.settlementAmount,
    status: input.status,
    finalizedAt: input.finalizedAt,
    voidedAt: input.voidedAt,
    description: input.description,
    externalRef: input.externalRef,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function toCommissionSettlement(
  document: CommissionSettlementDocument,
): CommissionSettlement {
  return {
    id: document._id,
    settlementCode: document.settlementCode,
    title: document.title,
    normalizedTitle: document.normalizedTitle,
    sourceRuleId: document.sourceRuleId,
    sourceContractRecordIdSnapshot:
      document.sourceContractRecordIdSnapshot,
    settlementKindSnapshot:
      document.settlementKindSnapshot,
    beneficiaryKindSnapshot:
      document.beneficiaryKindSnapshot,
    beneficiaryEmploymentProfileIdSnapshot:
      document.beneficiaryEmploymentProfileIdSnapshot,
    beneficiaryTalentIdSnapshot:
      document.beneficiaryTalentIdSnapshot,
    subjectTalentId: document.subjectTalentId,
    settlementBasisSnapshot:
      document.settlementBasisSnapshot,
    ratePercentSnapshot: document.ratePercentSnapshot,
    revenueEntryIds: [...document.revenueEntryIds],
    settlementPeriodStartAt:
      document.settlementPeriodStartAt,
    settlementPeriodEndAt:
      document.settlementPeriodEndAt,
    settlementCurrencyCode:
      document.settlementCurrencyCode,
    grossRevenueAmount: document.grossRevenueAmount,
    settlementAmount: document.settlementAmount,
    status: document.status,
    finalizedAt: document.finalizedAt,
    voidedAt: document.voidedAt,
    description: document.description,
    externalRef: document.externalRef,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function toCommissionSettlementLineDocument(
  input: CommissionSettlementLine,
): CommissionSettlementLineDocument {
  return {
    _id: input.id,
    settlementId: input.settlementId,
    revenueEntryId: input.revenueEntryId,
    revenueEntryCodeSnapshot:
      input.revenueEntryCodeSnapshot,
    revenueKindSnapshot: input.revenueKindSnapshot,
    revenueCurrencyCodeSnapshot:
      input.revenueCurrencyCodeSnapshot,
    revenueRecognizedAmountSnapshot:
      input.revenueRecognizedAmountSnapshot,
    revenueRecognizedAtSnapshot:
      input.revenueRecognizedAtSnapshot,
    lineSettlementAmount: input.lineSettlementAmount,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function toCommissionSettlementLine(
  document: CommissionSettlementLineDocument,
): CommissionSettlementLine {
  return {
    id: document._id,
    settlementId: document.settlementId,
    revenueEntryId: document.revenueEntryId,
    revenueEntryCodeSnapshot:
      document.revenueEntryCodeSnapshot,
    revenueKindSnapshot: document.revenueKindSnapshot,
    revenueCurrencyCodeSnapshot:
      document.revenueCurrencyCodeSnapshot,
    revenueRecognizedAmountSnapshot:
      document.revenueRecognizedAmountSnapshot,
    revenueRecognizedAtSnapshot:
      document.revenueRecognizedAtSnapshot,
    lineSettlementAmount: document.lineSettlementAmount,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
