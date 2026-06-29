import { ClientSession, Collection, Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository";
import { ReferenceSummary } from "@modules/reference-summary";
import {
  ResponsibilityAssignmentFilters,
  ResponsibilityAssignmentRepository,
  RevokeResponsibilityAssignmentInput,
  UpdateResponsibilityAssignmentInput,
} from "@modules/responsibility/domain/responsibility.repository";
import {
  ResponsibilityManagedOrgUnitScope,
  ResponsibilityManagedScope,
  ResponsibilityManagedScopeReader,
} from "@modules/responsibility/domain/responsibility-managed-scope";
import {
  ResponsibilityAssignmentRecord,
  ResponsibilityAssignmentView,
  ResponsibilityStatus,
  ResponsibilitySubjectType,
  ResponsibilityType,
} from "@modules/responsibility/domain/responsibility.types";

interface ResponsibilityAssignmentDocument {
  readonly _id: string;
  readonly subjectType: ResponsibilitySubjectType;
  readonly subjectId: string;
  readonly responsibleEmploymentProfileId: string;
  readonly responsibilityType: ResponsibilityType;
  readonly responsibilityRole: string | null;
  readonly includeDescendants: boolean | null;
  readonly actionMask?: readonly string[];
  readonly isPrimary: boolean;
  readonly status: ResponsibilityStatus;
  readonly effectiveAt: number;
  readonly expiresAt: number | null;
  readonly revokedAt: number | null;
  readonly reason: string | null;
  readonly createdBy: string;
  readonly createdAt: number;
  readonly updatedBy: string;
  readonly updatedAt: number;
  readonly revokedBy: string | null;
  readonly revokedReason: string | null;
}

interface TalentDocument {
  readonly _id: string;
  readonly talentCode: string;
  readonly stageName: string;
  readonly legalName: string;
  readonly operationalStatus: string;
}

interface TalentGroupDocument {
  readonly _id: string;
  readonly groupCode: string;
  readonly name: string;
  readonly status: string;
}

interface TalentGroupMemberDocument {
  readonly _id: string;
  readonly groupId: string;
  readonly talentId: string;
  readonly membershipStatus: string;
}

interface EmploymentProfileDocument {
  readonly _id: string;
  readonly employeeCode: string;
  readonly displayName: string;
  readonly legalName: string;
  readonly jobTitle?: string;
  readonly employmentStatus: string;
  readonly orgUnitId?: string;
}

interface OrgUnitDocument {
  readonly _id: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
  readonly ancestorChain?: readonly string[];
}

const CENTRAL_COLLECTION = "responsibility_assignments";
const DEFAULT_LIMIT = 100;

export class NativeMongoResponsibilityAssignmentRepository
  extends BaseRepository<ResponsibilityAssignmentDocument>
  implements ResponsibilityAssignmentRepository, ResponsibilityManagedScopeReader
{
  private readonly talents: Collection<TalentDocument>;
  private readonly talentGroups: Collection<TalentGroupDocument>;
  private readonly talentGroupMembers: Collection<TalentGroupMemberDocument>;
  private readonly employmentProfiles: Collection<EmploymentProfileDocument>;
  private readonly orgUnits: Collection<OrgUnitDocument>;

  constructor(db: Db) {
    super(db, CENTRAL_COLLECTION);
    this.talents = db.collection("talents");
    this.talentGroups = db.collection("talent_groups");
    this.talentGroupMembers = db.collection("talent_group_members");
    this.employmentProfiles = db.collection("employment_profiles");
    this.orgUnits = db.collection("org_units");
  }

  async insert(
    assignment: ResponsibilityAssignmentRecord,
    session?: ClientSession,
  ): Promise<ResponsibilityAssignmentRecord> {
    await this.collection.insertOne(toDocument(assignment), this.withSession(session));
    return assignment;
  }

  async listNormalized(
    filters: ResponsibilityAssignmentFilters,
    session?: ClientSession,
  ): Promise<readonly ResponsibilityAssignmentView[]> {
    const assignments = await this.listCentral(filters, session);
    return Array.from(assignments)
      .sort((left: ResponsibilityAssignmentView, right: ResponsibilityAssignmentView) =>
        sortResponsibility(left, right),
      )
      .slice(0, filters.limit ?? DEFAULT_LIMIT);
  }

  async findNormalizedById(
    assignmentId: string,
    session?: ClientSession,
  ): Promise<ResponsibilityAssignmentView | null> {
    const central = await this.collection.findOne(
      { _id: assignmentId },
      this.withSession(session),
    );
    if (central) {
      return this.toView(toDomain(central), session);
    }

    return null;
  }

  async listActiveCentralPrimary(
    filters: {
      readonly subjectType: ResponsibilitySubjectType;
      readonly subjectId: string;
      readonly responsibilityType: ResponsibilityType;
      readonly excludeAssignmentId?: string;
      readonly asOf: number;
    },
    session?: ClientSession,
  ): Promise<readonly ResponsibilityAssignmentRecord[]> {
    const docs = await this.collection
      .find(
        {
          ...(filters.excludeAssignmentId
            ? { _id: { $ne: filters.excludeAssignmentId } }
            : {}),
          subjectType: filters.subjectType,
          subjectId: filters.subjectId,
          responsibilityType: filters.responsibilityType,
          isPrimary: true,
          status: "ACTIVE",
          effectiveAt: { $lte: filters.asOf },
          $or: [{ expiresAt: null }, { expiresAt: { $gte: filters.asOf } }],
        },
        this.withSession(session),
      )
      .toArray();
    return docs.map((doc) => toDomain(doc));
  }

  async resolveManagedScopeByResponsibleEmploymentProfile(
    input: {
      readonly responsibleEmploymentProfileId: string;
      readonly asOf: number;
    },
    session?: ClientSession,
  ): Promise<ResponsibilityManagedScope> {
    const docs = await this.collection
      .find(
        {
          responsibleEmploymentProfileId:
            input.responsibleEmploymentProfileId,
          status: "ACTIVE",
          effectiveAt: { $lte: input.asOf },
          $and: [
            { $or: [{ expiresAt: null }, { expiresAt: { $gte: input.asOf } }] },
            {
              $or: [
                {
                  subjectType: "TALENT_GROUP",
                  responsibilityType: "TALENT_GROUP_MANAGER",
                },
                {
                  subjectType: "ORG_UNIT",
                  responsibilityType: "ORG_UNIT_MANAGER",
                },
              ],
            },
          ],
        },
        this.withSession(session),
      )
      .sort({ subjectType: 1, subjectId: 1, _id: 1 })
      .toArray();

    const talentGroupIds = uniqueNonEmpty(
      docs
        .filter(
          (doc) =>
            doc.subjectType === "TALENT_GROUP" &&
            doc.responsibilityType === "TALENT_GROUP_MANAGER",
        )
        .map((doc) => doc.subjectId),
    );
    const orgUnitScopes = uniqueManagedOrgUnitScopes(
      docs
        .filter(
          (doc) =>
            doc.subjectType === "ORG_UNIT" &&
            doc.responsibilityType === "ORG_UNIT_MANAGER",
        )
        .map((doc) => ({
          orgUnitId: doc.subjectId,
          role: doc.responsibilityRole,
          includeDescendants: doc.includeDescendants === true,
          actionMask: doc.actionMask ?? [],
          isPrimary: doc.isPrimary,
        })),
    );
    const directOrgUnitIds = uniqueNonEmpty(
      orgUnitScopes.map((scope) => scope.orgUnitId),
    );
    const activeDirectOrgUnitIds = await this.listActiveOrgUnitIds(
      directOrgUnitIds,
      session,
    );
    const activeDirectSet = new Set(activeDirectOrgUnitIds);
    const descendantSourceIds = uniqueNonEmpty(
      orgUnitScopes
        .filter(
          (scope) =>
            scope.includeDescendants && activeDirectSet.has(scope.orgUnitId),
        )
        .map((scope) => scope.orgUnitId),
    );
    const descendantOrgUnitIds =
      await this.listActiveOrgUnitDescendantIds(descendantSourceIds, session);

    return {
      talentGroupIds,
      orgUnitIds: uniqueNonEmpty([
        ...activeDirectOrgUnitIds,
        ...descendantOrgUnitIds,
      ]),
      orgUnitScopes,
    };
  }

  async update(
    input: UpdateResponsibilityAssignmentInput,
    session?: ClientSession,
  ): Promise<ResponsibilityAssignmentRecord | null> {
    const $set: {
      responsibilityRole?: string | null;
      includeDescendants?: boolean | null;
      actionMask?: readonly string[];
      isPrimary?: boolean;
      effectiveAt?: number;
      expiresAt?: number | null;
      reason?: string | null;
      updatedAt: number;
      updatedBy: string;
    } = {
      updatedAt: input.updatedAt,
      updatedBy: input.updatedBy,
    };
    if (input.responsibilityRole !== undefined) {
      $set.responsibilityRole = input.responsibilityRole;
    }
    if (input.includeDescendants !== undefined) {
      $set.includeDescendants = input.includeDescendants;
    }
    if (input.actionMask !== undefined) {
      $set.actionMask = input.actionMask;
    }
    if (input.isPrimary !== undefined) {
      $set.isPrimary = input.isPrimary;
    }
    if (input.effectiveAt !== undefined) {
      $set.effectiveAt = input.effectiveAt;
    }
    if (input.expiresAt !== undefined) {
      $set.expiresAt = input.expiresAt;
    }
    if (input.reason !== undefined) {
      $set.reason = input.reason;
    }

    const updated = await this.collection.findOneAndUpdate(
      { _id: input.assignmentId, status: "ACTIVE" },
      { $set },
      { ...this.withSession(session), returnDocument: "after" },
    );
    return updated ? toDomain(updated) : null;
  }

  async revoke(
    input: RevokeResponsibilityAssignmentInput,
    session?: ClientSession,
  ): Promise<ResponsibilityAssignmentRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      { _id: input.assignmentId, status: "ACTIVE" },
      {
        $set: {
          status: "REVOKED",
          expiresAt: input.revokedAt,
          revokedAt: input.revokedAt,
          revokedBy: input.revokedBy,
          revokedReason: input.revokedReason,
          updatedAt: input.revokedAt,
          updatedBy: input.revokedBy,
        },
      },
      { ...this.withSession(session), returnDocument: "after" },
    );
    return updated ? toDomain(updated) : null;
  }

  async listInheritedForTalent(
    talentId: string,
    asOf: number,
    session?: ClientSession,
  ): Promise<readonly ResponsibilityAssignmentView[]> {
    const talent = await this.talents.findOne(
      { _id: talentId },
      this.withSession(session),
    );
    if (!talent || talent.operationalStatus !== "ACTIVE") {
      return [];
    }

    const memberships = await this.talentGroupMembers
      .find({ talentId, membershipStatus: "ACTIVE" }, this.withSession(session))
      .toArray();
    const views: ResponsibilityAssignmentView[] = [];
    for (const membership of memberships) {
      views.push(
        ...(await this.listNormalized(
          {
            subjectType: "TALENT_GROUP",
            subjectId: membership.groupId,
            responsibilityType: "TALENT_GROUP_MANAGER",
            active: true,
            asOf,
          },
          session,
        )),
      );
    }
    return views;
  }

  async listInheritedForEmploymentProfile(
    employmentProfileId: string,
    asOf: number,
    session?: ClientSession,
  ): Promise<readonly ResponsibilityAssignmentView[]> {
    const profile = await this.employmentProfiles.findOne(
      { _id: employmentProfileId },
      this.withSession(session),
    );
    if (!profile || !["ACTIVE", "ON_LEAVE"].includes(profile.employmentStatus)) {
      return [];
    }
    if (!profile?.orgUnitId) {
      return [];
    }
    const orgUnit = await this.orgUnits.findOne(
      { _id: profile.orgUnitId },
      this.withSession(session),
    );
    const candidateOrgUnitIds = [
      profile.orgUnitId,
      ...(orgUnit?.ancestorChain ?? []),
    ];
    const inherited: ResponsibilityAssignmentView[] = [];
    for (const orgUnitId of candidateOrgUnitIds) {
      const rows = await this.listNormalized(
        {
          subjectType: "ORG_UNIT",
          subjectId: orgUnitId,
          responsibilityType: "ORG_UNIT_MANAGER",
          active: true,
          asOf,
        },
        session,
      );
      inherited.push(
        ...rows.filter(
          (row) => row.subjectId === profile.orgUnitId || row.includeDescendants === true,
        ),
      );
    }
    return inherited;
  }

  private async listCentral(
    filters: ResponsibilityAssignmentFilters,
    session?: ClientSession,
  ): Promise<readonly ResponsibilityAssignmentView[]> {
    const docs = await this.collection
      .find(buildCentralFilter(filters), this.withSession(session))
      .sort({ updatedAt: -1, _id: 1 })
      .limit(filters.limit ?? DEFAULT_LIMIT)
      .toArray();
    const views: ResponsibilityAssignmentView[] = [];
    for (const doc of docs) {
      views.push(await this.toView(toDomain(doc), session));
    }
    return views;
  }

  private async toView(
    record: ResponsibilityAssignmentRecord,
    session?: ClientSession,
  ): Promise<ResponsibilityAssignmentView> {
    const [subjectRef, responsibleEmploymentProfileRef] = await Promise.all([
      this.findSubjectRef(record.subjectType, record.subjectId, session),
      this.findEmploymentProfileRef(record.responsibleEmploymentProfileId, session),
    ]);

    const review = await this.resolveReviewState(record, session);
    return {
      ...record,
      reviewNeeded: record.reviewNeeded || review.reviewNeeded,
      reviewReason: record.reviewReason ?? review.reviewReason,
      subjectRef,
      responsibleEmploymentProfileRef,
    };
  }

  async findSubjectRef(
    subjectType: ResponsibilitySubjectType,
    subjectId: string,
    session?: ClientSession,
  ): Promise<ReferenceSummary | null> {
    if (subjectType === "TALENT_GROUP") {
      const doc = await this.talentGroups.findOne(
        { _id: subjectId },
        this.withSession(session),
      );
      return doc
        ? { id: doc._id, code: doc.groupCode, name: doc.name, status: doc.status }
        : null;
    }
    if (subjectType === "ORG_UNIT") {
      const doc = await this.orgUnits.findOne({ _id: subjectId }, this.withSession(session));
      return doc ? { id: doc._id, code: doc.code, name: doc.name, status: doc.status } : null;
    }
    if (subjectType === "TALENT") {
      const doc = await this.talents.findOne({ _id: subjectId }, this.withSession(session));
      return doc
        ? { id: doc._id, code: doc.talentCode, name: doc.stageName, status: doc.operationalStatus }
        : null;
    }
    const profile = await this.employmentProfiles.findOne(
      { _id: subjectId },
      this.withSession(session),
    );
    return profile ? employmentProfileRef(profile) : null;
  }

  private async listActiveOrgUnitIds(
    orgUnitIds: readonly string[],
    session?: ClientSession,
  ): Promise<readonly string[]> {
    const ids = uniqueNonEmpty(orgUnitIds);
    if (ids.length === 0) {
      return [];
    }
    const docs = await this.orgUnits
      .find(
        { _id: { $in: ids }, status: "ACTIVE" },
        {
          ...this.withSession(session),
          projection: { _id: 1 },
        },
      )
      .sort({ _id: 1 })
      .toArray();
    return docs.map((doc) => doc._id);
  }

  private async listActiveOrgUnitDescendantIds(
    ancestorOrgUnitIds: readonly string[],
    session?: ClientSession,
  ): Promise<readonly string[]> {
    const ids = uniqueNonEmpty(ancestorOrgUnitIds);
    if (ids.length === 0) {
      return [];
    }
    const docs = await this.orgUnits
      .find(
        { ancestorChain: { $in: ids }, status: "ACTIVE" },
        {
          ...this.withSession(session),
          projection: { _id: 1 },
        },
      )
      .sort({ _id: 1 })
      .toArray();
    return docs.map((doc) => doc._id);
  }

  async findEmploymentProfileRef(
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<ReferenceSummary | null> {
    const profile = await this.employmentProfiles.findOne(
      { _id: employmentProfileId },
      this.withSession(session),
    );
    return profile ? employmentProfileRef(profile) : null;
  }

  private async resolveReviewState(
    record: ResponsibilityAssignmentRecord,
    session?: ClientSession,
  ): Promise<{ readonly reviewNeeded: boolean; readonly reviewReason: string | null }> {
    const responsible = await this.employmentProfiles.findOne(
      { _id: record.responsibleEmploymentProfileId },
      this.withSession(session),
    );
    if (!responsible || !["ACTIVE", "ON_LEAVE"].includes(responsible.employmentStatus)) {
      return { reviewNeeded: true, reviewReason: "RESPONSIBLE_PROFILE_NOT_ACTIVE" };
    }
    const subject = await this.findSubjectRef(record.subjectType, record.subjectId, session);
    if (!subject) {
      return { reviewNeeded: true, reviewReason: "SUBJECT_NOT_FOUND" };
    }
    if (["INACTIVE", "TERMINATED", "ARCHIVED", "SUSPENDED"].includes(subject.status ?? "")) {
      return { reviewNeeded: true, reviewReason: "SUBJECT_NOT_ACTIVE" };
    }
    return { reviewNeeded: false, reviewReason: null };
  }
}

function uniqueManagedOrgUnitScopes(
  scopes: readonly ResponsibilityManagedOrgUnitScope[],
): readonly ResponsibilityManagedOrgUnitScope[] {
  const byKey = new Map<string, ResponsibilityManagedOrgUnitScope>();
  for (const scope of scopes) {
    const orgUnitId = scope.orgUnitId.trim();
    if (!orgUnitId) {
      continue;
    }
    const actionMask = [...uniqueNonEmpty(scope.actionMask)].sort();
    const key = [
      orgUnitId,
      scope.role ?? "",
      scope.includeDescendants ? "desc" : "direct",
      actionMask.join(","),
      scope.isPrimary ? "primary" : "non-primary",
    ].join(":");
    if (!byKey.has(key)) {
      byKey.set(key, { ...scope, orgUnitId, actionMask });
    }
  }
  return [...byKey.values()];
}

function uniqueNonEmpty(values: readonly string[]): readonly string[] {
  return [
    ...new Set(
      values.map((value) => value.trim()).filter((value) => value.length > 0),
    ),
  ];
}

function toDocument(
  input: ResponsibilityAssignmentRecord,
): ResponsibilityAssignmentDocument {
  return {
    _id: input.id,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    responsibleEmploymentProfileId: input.responsibleEmploymentProfileId,
    responsibilityType: input.responsibilityType,
    responsibilityRole: input.responsibilityRole,
    includeDescendants: input.includeDescendants,
    actionMask: input.actionMask,
    isPrimary: input.isPrimary,
    status: input.status,
    effectiveAt: input.effectiveAt,
    expiresAt: input.expiresAt,
    revokedAt: input.revokedAt,
    reason: input.reason,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    updatedBy: input.updatedBy,
    updatedAt: input.updatedAt,
    revokedBy: input.revokedBy,
    revokedReason: input.revokedReason,
  };
}

function toDomain(doc: ResponsibilityAssignmentDocument): ResponsibilityAssignmentRecord {
  return {
    id: doc._id,
    subjectType: doc.subjectType,
    subjectId: doc.subjectId,
    responsibleEmploymentProfileId: doc.responsibleEmploymentProfileId,
    responsibilityType: doc.responsibilityType,
    responsibilityRole: doc.responsibilityRole,
    includeDescendants: doc.includeDescendants,
    actionMask: doc.actionMask ?? [],
    isPrimary: doc.isPrimary,
    status: doc.status,
    effectiveAt: doc.effectiveAt,
    expiresAt: doc.expiresAt,
    revokedAt: doc.revokedAt,
    reason: doc.reason,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    updatedBy: doc.updatedBy,
    updatedAt: doc.updatedAt,
    revokedBy: doc.revokedBy,
    revokedReason: doc.revokedReason,
    reviewNeeded: false,
    reviewReason: null,
  };
}

function buildCentralFilter(
  filters: ResponsibilityAssignmentFilters,
): Record<string, unknown> {
  return {
    ...(filters.responsibleEmploymentProfileId
      ? { responsibleEmploymentProfileId: filters.responsibleEmploymentProfileId }
      : {}),
    ...(filters.subjectType ? { subjectType: filters.subjectType } : {}),
    ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
    ...(filters.responsibilityType
      ? { responsibilityType: filters.responsibilityType }
      : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.active === true
      ? {
          status: "ACTIVE",
          effectiveAt: { $lte: filters.asOf },
          $or: [{ expiresAt: null }, { expiresAt: { $gte: filters.asOf } }],
        }
      : {}),
  };
}

function sortResponsibility(
  left: ResponsibilityAssignmentView,
  right: ResponsibilityAssignmentView,
): number {
  if (left.isPrimary !== right.isPrimary) {
    return left.isPrimary ? -1 : 1;
  }
  return right.updatedAt - left.updatedAt || left.id.localeCompare(right.id);
}

function employmentProfileRef(profile: EmploymentProfileDocument): ReferenceSummary {
  return {
    id: profile._id,
    code: profile.employeeCode,
    displayName: profile.displayName,
    name: profile.legalName,
    status: profile.employmentStatus,
  };
}
