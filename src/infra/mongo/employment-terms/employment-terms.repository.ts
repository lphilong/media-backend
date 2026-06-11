import { ClientSession, Collection, Db } from "mongodb";
import {
  buildGeneratedBusinessCodeRegex,
  BusinessCodePolicy,
  parseGeneratedBusinessCodeSequence,
} from "@core/business-code/business-code-sequence.repository";
import { BaseRepository } from "@infra/database/repository";
import {
  EmploymentTermsRepository,
  TransitionEmploymentTermsInput,
  UpdateEmploymentTermsDraftInput,
} from "@modules/employment-terms/domain/employment-terms.repository";
import { EmploymentTermsRecord } from "@modules/employment-terms/domain/employment-terms.types";

interface EmploymentTermsDocument extends Omit<EmploymentTermsRecord, "id"> {
  readonly _id: string;
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
