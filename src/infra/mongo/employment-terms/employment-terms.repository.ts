import { ClientSession, Collection, Db } from "mongodb";
import {
  buildGeneratedBusinessCodeRegex,
  BusinessCodePolicy,
  parseGeneratedBusinessCodeSequence,
} from "@core/business-code/business-code-sequence.repository";
import { BaseRepository } from "@infra/database/repository";
import {
  EmploymentTermsRepository,
  ListEmploymentTermsAdminRecordsInput,
  TransitionEmploymentTermsInput,
  UpdateEmploymentTermsDraftInput,
} from "@modules/employment-terms/domain/employment-terms.repository";
import {
  EmploymentTermsAdminListRecord,
  EmploymentTermsOverlapContextRecord,
  EmploymentTermsRecord,
} from "@modules/employment-terms/domain/employment-terms.types";
import { EmploymentStatus } from "@modules/employment-profile/domain/employment-profile.types";
import { OrgUnitStatus } from "@modules/org-unit/domain/org-unit.types";
import { UserAccountStatus } from "@modules/user/domain/user.types";

interface EmploymentTermsDocument extends Omit<EmploymentTermsRecord, "id"> {
  readonly _id: string;
}

interface EmploymentProfileLookupDocument {
  readonly _id: string;
  readonly employeeCode: string;
  readonly legalName: string;
  readonly normalizedLegalName: string;
  readonly displayName: string;
  readonly normalizedDisplayName: string;
  readonly orgUnitId: string;
  readonly linkedUserId: string | null;
  readonly employmentStatus: EmploymentStatus;
}

interface OrgUnitLookupDocument {
  readonly _id: string;
  readonly code: string;
  readonly name: string;
  readonly status: OrgUnitStatus;
}

interface UserLookupDocument {
  readonly _id: string;
  readonly profile: {
    readonly displayName: string;
    readonly email?: string;
  };
  readonly accountStatus: UserAccountStatus;
}

interface EmploymentTermsAdminAggregateDocument extends EmploymentTermsDocument {
  readonly employmentProfile: EmploymentProfileLookupDocument;
  readonly orgUnit?: OrgUnitLookupDocument | null;
  readonly linkedUser?: UserLookupDocument | null;
}

interface EmploymentTermsOverlapContextDocument {
  readonly _id: string;
  readonly employmentProfileId: string;
  readonly status: "APPROVED";
  readonly payrollEligible: true;
  readonly effectiveFrom: number;
  readonly effectiveTo: number | null;
}

export class NativeMongoEmploymentTermsRepository
  extends BaseRepository<EmploymentTermsDocument>
  implements EmploymentTermsRepository
{
  private readonly approvalGuardCollection: Collection<{
    _id: string;
    approvalSequence: number;
    updatedAt: number;
  }>;

  constructor(db: Db) {
    super(db, "employment_terms");
    this.approvalGuardCollection = db.collection("employment_terms_approval_guards");
  }

  async acquireApprovalLock(employmentProfileId: string, session: ClientSession): Promise<void> {
    await this.approvalGuardCollection.updateOne(
      { _id: employmentProfileId },
      { $inc: { approvalSequence: 1 }, $set: { updatedAt: Date.now() } },
      { ...this.withSession(session), upsert: true },
    );
  }

  async insert(record: EmploymentTermsRecord, session: ClientSession): Promise<EmploymentTermsRecord> {
    await this.collection.insertOne(toDocument(record), this.withSession(session));
    return record;
  }

  async findById(id: string, session?: ClientSession): Promise<EmploymentTermsRecord | null> {
    const document = await this.collection.findOne({ _id: id }, this.withSession(session));
    return document ? toRecord(document) : null;
  }

  async listByEmploymentProfileId(employmentProfileId: string): Promise<readonly EmploymentTermsRecord[]> {
    const documents = await this.collection
      .find({ employmentProfileId })
      .sort({ effectiveFrom: -1, createdAt: -1, _id: 1 })
      .toArray();
    return documents.map(toRecord);
  }

  async updateDraft(input: UpdateEmploymentTermsDraftInput, session: ClientSession): Promise<EmploymentTermsRecord | null> {
    const set: Record<string, unknown> = {
      updatedBy: input.updatedBy,
      updatedAt: input.updatedAt,
    };
    for (const field of [
      "effectiveFrom",
      "effectiveTo",
      "baseSalaryAmount",
      "currencyCode",
      "payFrequency",
      "allowances",
      "payrollEligible",
      "sourceNote",
    ] as const) {
      if (input[field] !== undefined) set[field] = input[field];
    }
    const document = await this.collection.findOneAndUpdate(
      { _id: input.id, employmentProfileId: input.employmentProfileId, status: "DRAFT" },
      { $set: set, $inc: { version: 1 } },
      { ...this.withSession(session), returnDocument: "after" },
    );
    return document ? toRecord(document) : null;
  }

  async transition(input: TransitionEmploymentTermsInput, session: ClientSession): Promise<EmploymentTermsRecord | null> {
    const set: Record<string, unknown> = {
      status: input.toStatus,
      updatedBy: input.updatedBy,
      updatedAt: input.updatedAt,
    };
    for (const field of [
      "submittedBy",
      "submittedAt",
      "approvedBy",
      "approvedAt",
      "cancelledBy",
      "cancelledAt",
    ] as const) {
      if (input[field] !== undefined) set[field] = input[field];
    }
    const document = await this.collection.findOneAndUpdate(
      {
        _id: input.id,
        employmentProfileId: input.employmentProfileId,
        status: { $in: [...input.fromStatuses] },
      },
      { $set: set, $inc: { version: 1 } },
      { ...this.withSession(session), returnDocument: "after" },
    );
    return document ? toRecord(document) : null;
  }

  async findOverlappingApprovedPayrollReadable(
    employmentProfileId: string,
    effectiveFrom: number,
    effectiveTo: number | null,
    excludeId?: string,
    session?: ClientSession,
  ): Promise<EmploymentTermsRecord | null> {
    const document = await this.collection.findOne(
      {
        employmentProfileId,
        status: "APPROVED",
        payrollEligible: true,
        ...(excludeId ? { _id: { $ne: excludeId } } : {}),
        effectiveFrom: { $lte: effectiveTo ?? Number.MAX_SAFE_INTEGER },
        $or: [{ effectiveTo: null }, { effectiveTo: { $gte: effectiveFrom } }],
      },
      this.withSession(session),
    );
    return document ? toRecord(document) : null;
  }

  async findPayrollReadableForDate(
    employmentProfileId: string,
    date: number,
    session?: ClientSession,
  ): Promise<readonly EmploymentTermsRecord[]> {
    const documents = await this.collection
      .find(
        {
          employmentProfileId,
          status: "APPROVED",
          payrollEligible: true,
          effectiveFrom: { $lte: date },
          $or: [{ effectiveTo: null }, { effectiveTo: { $gte: date } }],
        },
        this.withSession(session),
      )
      .sort({ effectiveFrom: -1, approvedAt: -1, _id: 1 })
      .toArray();
    return documents.map(toRecord);
  }

  async listAdminRecords(
    input: ListEmploymentTermsAdminRecordsInput,
  ): Promise<readonly EmploymentTermsAdminListRecord[]> {
    const pipeline: Array<Record<string, unknown>> = [];
    const termsFilters: Array<Record<string, unknown>> = [];

    if (input.employmentProfileId) {
      termsFilters.push({ employmentProfileId: input.employmentProfileId });
    }
    if (input.status) {
      termsFilters.push({ status: input.status });
    }
    if (input.payrollEligible !== undefined) {
      termsFilters.push({ payrollEligible: input.payrollEligible });
    }
    if (input.effectiveOn !== undefined) {
      termsFilters.push({
        effectiveFrom: { $lte: input.effectiveOn },
        $or: [{ effectiveTo: null }, { effectiveTo: { $gte: input.effectiveOn } }],
      });
    }
    if (input.expiringBefore !== undefined) {
      termsFilters.push({
        effectiveTo: { $ne: null, $lte: input.expiringBefore },
      });
    }
    appendReadinessCoarseFilters(termsFilters, input);

    if (termsFilters.length > 0) {
      pipeline.push({ $match: buildQuery(termsFilters) });
    }
    if (input.readiness === "OVERLAPPING") {
      appendOverlapCoarseFilter(pipeline);
    }

    pipeline.push(
      {
        $lookup: {
          from: "employment_profiles",
          let: { employmentProfileId: "$employmentProfileId" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$_id", "$$employmentProfileId"] },
              },
            },
            {
              $project: {
                _id: 1,
                employeeCode: 1,
                legalName: 1,
                normalizedLegalName: 1,
                displayName: 1,
                normalizedDisplayName: 1,
                orgUnitId: 1,
                linkedUserId: 1,
                employmentStatus: 1,
              },
            },
          ],
          as: "employmentProfile",
        },
      },
      { $unwind: "$employmentProfile" },
    );

    const profileFilters: Array<Record<string, unknown>> = [];
    if (input.employmentStatus) {
      profileFilters.push({
        "employmentProfile.employmentStatus": input.employmentStatus,
      });
    } else {
      profileFilters.push({
        "employmentProfile.employmentStatus": { $ne: "ARCHIVED" },
      });
    }
    if (input.orgUnitId) {
      profileFilters.push({ "employmentProfile.orgUnitId": input.orgUnitId });
    }
    if (input.search) {
      profileFilters.push(buildProfileSearchFilter(input.search));
    }
    pipeline.push({ $match: buildQuery(profileFilters) });

    pipeline.push(
      {
        $lookup: {
          from: "org_units",
          let: { orgUnitId: "$employmentProfile.orgUnitId" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$_id", "$$orgUnitId"] },
              },
            },
            {
              $project: {
                _id: 1,
                code: 1,
                name: 1,
                status: 1,
              },
            },
          ],
          as: "orgUnit",
        },
      },
      {
        $unwind: {
          path: "$orgUnit",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "users",
          let: { linkedUserId: "$employmentProfile.linkedUserId" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$_id", "$$linkedUserId"] },
              },
            },
            {
              $project: {
                _id: 1,
                "profile.displayName": 1,
                "profile.email": 1,
                accountStatus: 1,
              },
            },
          ],
          as: "linkedUser",
        },
      },
      {
        $unwind: {
          path: "$linkedUser",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $sort: {
          "employmentProfile.displayName": 1,
          "employmentProfile.employeeCode": 1,
          effectiveFrom: -1,
          updatedAt: -1,
          _id: 1,
        },
      },
    );

    const documents = await this.collection
      .aggregate<EmploymentTermsAdminAggregateDocument>(pipeline)
      .toArray();
    return documents.map(toAdminListRecord);
  }

  async listOverlapContextByEmploymentProfileIds(
    employmentProfileIds: readonly string[],
  ): Promise<readonly EmploymentTermsOverlapContextRecord[]> {
    if (employmentProfileIds.length === 0) return [];
    const documents = await this.collection
      .find<EmploymentTermsOverlapContextDocument>(
        {
          employmentProfileId: { $in: [...new Set(employmentProfileIds)] },
          status: "APPROVED",
          payrollEligible: true,
        },
        {
          projection: {
            _id: 1,
            employmentProfileId: 1,
            status: 1,
            payrollEligible: 1,
            effectiveFrom: 1,
            effectiveTo: 1,
          },
        },
      )
      .toArray();
    return documents.map((document) => ({
      id: document._id,
      employmentProfileId: document.employmentProfileId,
      status: document.status,
      payrollEligible: document.payrollEligible,
      effectiveFrom: document.effectiveFrom,
      effectiveTo: document.effectiveTo,
    }));
  }

  async findMaxGeneratedCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
    session?: ClientSession,
  ): Promise<number> {
    const document = await this.collection
      .find({ termsCode: buildGeneratedBusinessCodeRegex(policy) }, this.withSession(session))
      .sort({ termsCode: -1 })
      .limit(1)
      .next();
    return document ? parseGeneratedBusinessCodeSequence(document.termsCode, policy) ?? 0 : 0;
  }
}

function toDocument(record: EmploymentTermsRecord): EmploymentTermsDocument {
  const { id, ...rest } = record;
  return { _id: id, ...rest };
}

function toRecord(document: EmploymentTermsDocument): EmploymentTermsRecord {
  const { _id, ...rest } = document;
  return { id: _id, ...rest };
}

function toAdminListRecord(
  document: EmploymentTermsAdminAggregateDocument,
): EmploymentTermsAdminListRecord {
  return {
    terms: toRecord(document),
    employmentProfile: {
      id: document.employmentProfile._id,
      employeeCode: document.employmentProfile.employeeCode,
      displayName: document.employmentProfile.displayName,
      legalName: document.employmentProfile.legalName,
      employmentStatus: document.employmentProfile.employmentStatus,
      orgUnitId: document.employmentProfile.orgUnitId,
      orgUnitRef: document.orgUnit
        ? {
            id: document.orgUnit._id,
            code: document.orgUnit.code,
            name: document.orgUnit.name,
            status: document.orgUnit.status,
          }
        : null,
      linkedUserRef: document.linkedUser
        ? {
            id: document.linkedUser._id,
            displayName: document.linkedUser.profile.displayName,
            name: document.linkedUser.profile.email,
            status: document.linkedUser.accountStatus,
          }
        : undefined,
    },
  };
}

function buildQuery(
  filters: readonly Record<string, unknown>[],
): Record<string, unknown> {
  if (filters.length === 0) return {};
  if (filters.length === 1) return filters[0] ?? {};
  return { $and: [...filters] };
}

function buildProfileSearchFilter(search: string): Record<string, unknown> {
  const normalizedNamePrefix = search
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
  const employeeCodePrefix = search
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");
  return {
    $or: [
      buildPrefixRange("employmentProfile.employeeCode", employeeCodePrefix),
      buildPrefixRange("employmentProfile.normalizedLegalName", normalizedNamePrefix),
      buildPrefixRange("employmentProfile.normalizedDisplayName", normalizedNamePrefix),
    ],
  };
}

function buildPrefixRange(field: string, prefix: string): Record<string, unknown> {
  return {
    [field]: {
      $gte: prefix,
      $lt: `${prefix}\uffff`,
    },
  };
}

function appendReadinessCoarseFilters(
  termsFilters: Array<Record<string, unknown>>,
  input: ListEmploymentTermsAdminRecordsInput,
): void {
  const asOfDate = input.readinessAsOf;
  switch (input.readiness) {
    case "CURRENT_EFFECTIVE":
      if (asOfDate !== undefined) {
        termsFilters.push({
          status: "APPROVED",
          payrollEligible: true,
          effectiveFrom: { $lte: asOfDate },
          $or: [{ effectiveTo: null }, { effectiveTo: { $gte: asOfDate } }],
        });
      }
      return;
    case "PENDING_APPROVAL":
      termsFilters.push({ status: "PENDING_APPROVAL", payrollEligible: true });
      return;
    case "EXPIRED":
      if (asOfDate !== undefined) {
        termsFilters.push({
          status: "APPROVED",
          payrollEligible: true,
          effectiveTo: { $ne: null, $lt: asOfDate },
        });
      }
      return;
    case "MISSING_BASE_SALARY":
      if (asOfDate !== undefined) {
        termsFilters.push({
          status: { $in: ["APPROVED", "PENDING_APPROVAL"] },
          payrollEligible: true,
          effectiveFrom: { $lte: asOfDate },
          $or: [{ effectiveTo: null }, { effectiveTo: { $gte: asOfDate } }],
        });
      }
      return;
    case "OVERLAPPING":
      termsFilters.push({ status: "APPROVED", payrollEligible: true });
      return;
    case "PAYROLL_SOURCE_ELIGIBLE":
      termsFilters.push({ payrollEligible: true });
      return;
    case "PAYROLL_SOURCE_INELIGIBLE":
      termsFilters.push({ payrollEligible: false });
      return;
    case undefined:
      return;
  }
}

function appendOverlapCoarseFilter(
  pipeline: Array<Record<string, unknown>>,
): void {
  pipeline.push(
    {
      $lookup: {
        from: "employment_terms",
        let: {
          profileId: "$employmentProfileId",
          termsId: "$_id",
          from: "$effectiveFrom",
          to: "$effectiveTo",
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$employmentProfileId", "$$profileId"] },
                  { $ne: ["$_id", "$$termsId"] },
                  { $eq: ["$status", "APPROVED"] },
                  { $eq: ["$payrollEligible", true] },
                  {
                    $lte: [
                      "$effectiveFrom",
                      { $ifNull: ["$$to", Number.MAX_SAFE_INTEGER] },
                    ],
                  },
                  {
                    $gte: [
                      { $ifNull: ["$effectiveTo", Number.MAX_SAFE_INTEGER] },
                      "$$from",
                    ],
                  },
                ],
              },
            },
          },
          { $project: { _id: 1 } },
          { $limit: 1 },
        ],
        as: "overlapMatches",
      },
    },
    { $match: { "overlapMatches.0": { $exists: true } } },
  );
}
