import { ClientSession, Collection, Db, Document } from "mongodb";
import {
  AccessLifecycleRepository,
  BreakGlassRepository,
  GovernancePrincipalRepository,
  BreakGlassExpiryEvidenceRecord,
  AccessAuthorityReconciliationRepository,
  GeneratedAccessPrerequisiteRecord,
  DueLifecycleTransitionCandidate,
} from "@modules/role/domain/access-lifecycle.repositories";
import {
  AssignmentLifecycleLineageRecord,
  AssignmentReviewCycleRecord,
  GraceExceptionRecord,
  SuspensionEvidenceRecord,
} from "@modules/role/domain/access-lifecycle-policy";
import {
  BreakGlassActivationRecord,
  BreakGlassRequestRecord,
} from "@modules/role/domain/break-glass";
import { GovernancePrincipalRecord } from "@modules/role/domain/governance-principal";
import {
  buildCurrentRoleReviewDeadlineExpression,
  buildCurrentRoleRiskTierExpression,
  buildRoleAssignmentReviewAuthorityEndExpression,
} from "@infra/mongo/user/user.auth.repository";
import {
  buildRoleAssignmentSuccessorCutoverEligibilityExpression,
  buildRoleAssignmentSuccessorPairClassificationExpression,
} from "./role-assignment-successor-cutover.expression";

type Stored<T, TIdKey extends keyof T> = Omit<T, TIdKey> & {
  readonly _id: string;
};
type GovernancePrincipalDocument = Stored<
  GovernancePrincipalRecord,
  "principalId"
>;
type ReviewCycleDocument = Stored<AssignmentReviewCycleRecord, "cycleId">;
type GraceExceptionDocument = Stored<GraceExceptionRecord, "exceptionId">;
type LineageDocument = Stored<AssignmentLifecycleLineageRecord, "lineageId">;
type SuspensionDocument = Stored<SuspensionEvidenceRecord, "suspensionId">;
type BreakGlassRequestDocument = Stored<BreakGlassRequestRecord, "requestId">;
type BreakGlassActivationDocument = Stored<
  BreakGlassActivationRecord,
  "activationId"
>;
type BreakGlassExpiryEvidenceDocument = Stored<
  BreakGlassExpiryEvidenceRecord,
  "transitionId"
>;

function sessionOptions(session?: ClientSession): {
  readonly session?: ClientSession;
} {
  return session ? { session } : {};
}

export class NativeMongoGovernancePrincipalRepository implements GovernancePrincipalRepository {
  private readonly collection: Collection<GovernancePrincipalDocument>;

  constructor(db: Db) {
    this.collection = db.collection("governance_principals");
  }

  async findActivePrimaryOwner(
    session?: ClientSession,
  ): Promise<GovernancePrincipalRecord | null> {
    const document = await this.collection.findOne(
      { principalType: "PRIMARY_OWNER", status: "ACTIVE" },
      sessionOptions(session),
    );
    return document
      ? fromStored<GovernancePrincipalRecord, "principalId">(
          document,
          "principalId",
        )
      : null;
  }

  async findEffectiveByUserId(
    userId: string,
    now: number,
    session?: ClientSession,
  ): Promise<readonly GovernancePrincipalRecord[]> {
    const documents = await this.collection
      .find(
        {
          userId,
          status: "ACTIVE",
          effectiveAt: { $lte: now },
          $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
        },
        sessionOptions(session),
      )
      .sort({ effectiveAt: 1, _id: 1 })
      .toArray();
    return documents.map((document) =>
      fromStored<GovernancePrincipalRecord, "principalId">(
        document,
        "principalId",
      ),
    );
  }

  async insert(
    record: GovernancePrincipalRecord,
    session: ClientSession,
  ): Promise<GovernancePrincipalRecord> {
    await this.collection.insertOne(toStored(record, "principalId"), {
      session,
    });
    return record;
  }
}

export class NativeMongoAccessLifecycleRepository implements AccessLifecycleRepository {
  private readonly assignments: Collection<Document & { readonly _id: string }>;
  private readonly reviewCycles: Collection<ReviewCycleDocument>;
  private readonly graceExceptions: Collection<GraceExceptionDocument>;
  private readonly lineages: Collection<LineageDocument>;
  private readonly suspensions: Collection<SuspensionDocument>;

  constructor(db: Db) {
    this.assignments = db.collection("role_assignments");
    this.reviewCycles = db.collection("assignment_review_cycles");
    this.graceExceptions = db.collection("assignment_grace_exceptions");
    this.lineages = db.collection("assignment_lifecycle_lineages");
    this.suspensions = db.collection("assignment_suspensions");
  }

  async findCurrentReviewCycle(
    assignmentId: string,
    session?: ClientSession,
  ): Promise<AssignmentReviewCycleRecord | null> {
    const document = await this.reviewCycles.findOne(
      { assignmentId },
      { ...sessionOptions(session), sort: { createdAt: -1, _id: -1 } },
    );
    return document
      ? fromStored<AssignmentReviewCycleRecord, "cycleId">(document, "cycleId")
      : null;
  }

  async findReviewCycleById(
    cycleId: string,
    session?: ClientSession,
  ): Promise<AssignmentReviewCycleRecord | null> {
    const document = await this.reviewCycles.findOne(
      { _id: cycleId },
      sessionOptions(session),
    );
    return document
      ? fromStored<AssignmentReviewCycleRecord, "cycleId">(document, "cycleId")
      : null;
  }

  async insertReviewCycle(
    record: AssignmentReviewCycleRecord,
    session: ClientSession,
  ): Promise<AssignmentReviewCycleRecord> {
    await this.reviewCycles.insertOne(toStored(record, "cycleId"), { session });
    return record;
  }

  async insertGraceException(
    record: GraceExceptionRecord,
    session: ClientSession,
  ): Promise<GraceExceptionRecord> {
    await this.graceExceptions.insertOne(toStored(record, "exceptionId"), {
      session,
    });
    return record;
  }

  async insertLineage(
    record: AssignmentLifecycleLineageRecord,
    session: ClientSession,
  ): Promise<AssignmentLifecycleLineageRecord> {
    await this.lineages.insertOne(toStored(record, "lineageId"), { session });
    return record;
  }

  async findLineageByIdempotencyKey(
    idempotencyKey: string,
    session?: ClientSession,
  ): Promise<AssignmentLifecycleLineageRecord | null> {
    const document = await this.lineages.findOne(
      { idempotencyKey },
      sessionOptions(session),
    );
    return document
      ? fromStored<AssignmentLifecycleLineageRecord, "lineageId">(
          document,
          "lineageId",
        )
      : null;
  }

  async insertSuspension(
    record: SuspensionEvidenceRecord,
    session: ClientSession,
  ): Promise<SuspensionEvidenceRecord> {
    await this.suspensions.insertOne(toStored(record, "suspensionId"), {
      session,
    });
    return record;
  }

  async listDueAssignmentIds(
    now: number,
    limit: number,
    session?: ClientSession,
  ): Promise<readonly string[]> {
    const documents = await this.reviewCycles
      .find(
        { state: "PENDING", reviewDeadline: { $lte: now } },
        { ...sessionOptions(session), projection: { assignmentId: 1 } },
      )
      .sort({ reviewDeadline: 1, _id: 1 })
      .limit(limit)
      .toArray();
    return [...new Set(documents.map((item) => item.assignmentId))];
  }

  async listDueLifecycleTransitionCandidates(
    input: { readonly now: number; readonly limit: number },
    session?: ClientSession,
  ): Promise<readonly DueLifecycleTransitionCandidate[]> {
    const now = input.now;
    const limit = Math.max(1, Math.min(input.limit, 500));
    const currentRiskTier = buildCurrentRoleRiskTierExpression();
    const currentReviewDeadline = buildCurrentRoleReviewDeadlineExpression();
    const candidateDeadline = buildRoleAssignmentReviewAuthorityEndExpression(
      currentRiskTier,
      currentReviewDeadline,
    );
    const unresolvedReviewTiming = {
      $and: [
        { $eq: ["$currentRiskTier", "HIGH"] },
        { $eq: ["$currentReviewDeadline", null] },
      ],
    };
    const pipeline: Document[] = [
      { $match: { state: { $in: ["ACTIVE", "SCHEDULED"] } } },
      {
        $lookup: {
          from: "roles",
          localField: "roleId",
          foreignField: "_id",
          pipeline: [
            { $match: { state: "ACTIVE" } },
            { $project: { _id: 1, code: 1, templateCode: 1, permissions: 1 } },
          ],
          as: "currentRoles",
        },
      },
      { $set: { currentRole: { $arrayElemAt: ["$currentRoles", 0] } } },
      {
        $set: {
          currentRiskTier,
          currentReviewDeadline,
          reviewAuthorityEnd: candidateDeadline,
          expiryBoundary: { $ifNull: ["$expiresAt", null] },
          successorPair:
            buildRoleAssignmentSuccessorPairClassificationExpression(),
        },
      },
      {
        $set: {
          candidateDeadline: {
            $cond: [
              { $eq: ["$successorPair", "MALFORMED_SUCCESSOR"] },
              now,
              {
                $cond: [
                  unresolvedReviewTiming,
                  now,
                  {
                    $cond: [
                      { $eq: ["$reviewAuthorityEnd", null] },
                      "$expiryBoundary",
                      {
                        $cond: [
                          { $eq: ["$expiryBoundary", null] },
                          "$reviewAuthorityEnd",
                          {
                            $min: ["$expiryBoundary", "$reviewAuthorityEnd"],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
      {
        $match: {
          $expr: {
            $and: [
              { $ne: [{ $ifNull: ["$currentRole", null] }, null] },
              {
                $or: [
                  { $eq: [{ $ifNull: ["$effectiveAt", null] }, null] },
                  { $lte: ["$effectiveAt", now] },
                  {
                    $and: [
                      { $eq: ["$state", "ACTIVE"] },
                      {
                        $or: [
                          {
                            $eq: ["$successorPair", "MALFORMED_SUCCESSOR"],
                          },
                          {
                            $and: [
                              { $eq: ["$currentRiskTier", "HIGH"] },
                              { $eq: ["$reviewAuthorityEnd", 0] },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                $or: [
                  {
                    $eq: ["$state", "ACTIVE"],
                  },
                  {
                    $and: [
                      { $eq: ["$state", "SCHEDULED"] },
                      { $isNumber: "$effectiveAt" },
                      { $lte: ["$effectiveAt", now] },
                    ],
                  },
                ],
              },
              {
                $or: [
                  { $eq: ["$successorPair", "MALFORMED_SUCCESSOR"] },
                  buildRoleAssignmentSuccessorCutoverEligibilityExpression(now),
                ],
              },
              { $isNumber: "$candidateDeadline" },
              { $lte: ["$candidateDeadline", now] },
            ],
          },
        },
      },
      { $sort: { candidateDeadline: 1, _id: 1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          assignmentId: "$_id",
          cycleId: {
            $cond: [
              { $eq: ["$successorPair", "MALFORMED_SUCCESSOR"] },
              { $concat: ["malformed-successor:", "$_id"] },
              {
                $cond: [
                  unresolvedReviewTiming,
                  { $concat: ["unresolved-review:", "$_id"] },
                  {
                    $cond: [
                      { $eq: ["$candidateDeadline", "$expiryBoundary"] },
                      { $concat: ["assignment-expiry:", "$_id"] },
                      {
                        $cond: [
                          {
                            $eq: [{ $type: "$lifecycle.cycleId" }, "string"],
                          },
                          "$lifecycle.cycleId",
                          {
                            $concat: [
                              "current-policy:",
                              "$_id",
                              ":",
                              { $toString: "$candidateDeadline" },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          candidateDeadline: 1,
          currentRiskTier: 1,
          roleId: 1,
          transitionReason: {
            $cond: [
              { $eq: ["$successorPair", "MALFORMED_SUCCESSOR"] },
              "MALFORMED_SUCCESSOR",
              {
                $cond: [
                  unresolvedReviewTiming,
                  "REVIEW_DEADLINE_UNRESOLVABLE",
                  {
                    $cond: [
                      { $eq: ["$candidateDeadline", "$expiryBoundary"] },
                      "ASSIGNMENT_EXPIRY",
                      "REVIEW_AUTHORITY_END",
                    ],
                  },
                ],
              },
            ],
          },
          cycleMatchRequired: {
            $and: [
              { $ne: ["$successorPair", "MALFORMED_SUCCESSOR"] },
              { $not: [unresolvedReviewTiming] },
              { $ne: ["$candidateDeadline", "$expiryBoundary"] },
              { $eq: [{ $type: "$lifecycle.cycleId" }, "string"] },
            ],
          },
        },
      },
    ];
    return await this.assignments
      .aggregate<DueLifecycleTransitionCandidate>(
        pipeline,
        sessionOptions(session),
      )
      .toArray();
  }
}

export class NativeMongoBreakGlassRepository implements BreakGlassRepository {
  private readonly requests: Collection<BreakGlassRequestDocument>;
  private readonly activations: Collection<BreakGlassActivationDocument>;
  private readonly expiryEvidence: Collection<BreakGlassExpiryEvidenceDocument>;

  constructor(db: Db) {
    this.requests = db.collection("break_glass_requests");
    this.activations = db.collection("break_glass_activations");
    this.expiryEvidence = db.collection("break_glass_expiry_evidence");
  }

  async findRequestById(
    requestId: string,
    session?: ClientSession,
  ): Promise<BreakGlassRequestRecord | null> {
    const document = await this.requests.findOne(
      { _id: requestId },
      sessionOptions(session),
    );
    return document
      ? fromStored<BreakGlassRequestRecord, "requestId">(document, "requestId")
      : null;
  }

  async findRequestByIdempotencyKey(
    idempotencyKey: string,
    session?: ClientSession,
  ): Promise<BreakGlassRequestRecord | null> {
    const document = await this.requests.findOne(
      { idempotencyKey },
      sessionOptions(session),
    );
    return document
      ? fromStored<BreakGlassRequestRecord, "requestId">(document, "requestId")
      : null;
  }

  async insertRequest(
    record: BreakGlassRequestRecord,
    session: ClientSession,
  ): Promise<BreakGlassRequestRecord> {
    await this.requests.insertOne(toStored(record, "requestId"), { session });
    return record;
  }

  async replaceRequestIfStatus(
    record: BreakGlassRequestRecord,
    expectedStatus: BreakGlassRequestRecord["status"],
    session: ClientSession,
  ): Promise<BreakGlassRequestRecord | null> {
    const { _id: _requestId, ...replacement } = toStored(record, "requestId");
    const document = await this.requests.findOneAndUpdate(
      { _id: record.requestId, status: expectedStatus },
      { $set: replacement },
      { session, returnDocument: "after" },
    );
    return document
      ? fromStored<BreakGlassRequestRecord, "requestId">(document, "requestId")
      : null;
  }

  async findActivationById(
    activationId: string,
    session?: ClientSession,
  ): Promise<BreakGlassActivationRecord | null> {
    const document = await this.activations.findOne(
      { _id: activationId },
      sessionOptions(session),
    );
    return document
      ? fromStored<BreakGlassActivationRecord, "activationId">(
          document,
          "activationId",
        )
      : null;
  }

  async findActivationByRequestId(
    requestId: string,
    session?: ClientSession,
  ): Promise<BreakGlassActivationRecord | null> {
    const document = await this.activations.findOne(
      { requestId },
      sessionOptions(session),
    );
    return document
      ? fromStored<BreakGlassActivationRecord, "activationId">(
          document,
          "activationId",
        )
      : null;
  }

  async insertActivation(
    record: BreakGlassActivationRecord,
    session: ClientSession,
  ): Promise<BreakGlassActivationRecord> {
    await this.activations.insertOne(toStored(record, "activationId"), {
      session,
    });
    return record;
  }

  async replaceActivationIfStatus(
    record: BreakGlassActivationRecord,
    expectedStatus: BreakGlassActivationRecord["status"],
    session: ClientSession,
  ): Promise<BreakGlassActivationRecord | null> {
    const { _id: _activationId, ...replacement } = toStored(
      record,
      "activationId",
    );
    const document = await this.activations.findOneAndUpdate(
      { _id: record.activationId, status: expectedStatus },
      { $set: replacement },
      { session, returnDocument: "after" },
    );
    return document
      ? fromStored<BreakGlassActivationRecord, "activationId">(
          document,
          "activationId",
        )
      : null;
  }

  async listEffectiveByUserId(
    userId: string,
    now: number,
    session?: ClientSession,
  ): Promise<readonly BreakGlassActivationRecord[]> {
    const documents = await this.activations
      .find(
        {
          targetUserId: userId,
          status: "ACTIVE",
          activatedAt: { $lte: now },
          expiresAt: { $gt: now },
          stepUpState: { $in: ["SATISFIED", "NOT_SUPPORTED"] },
        },
        sessionOptions(session),
      )
      .sort({ expiresAt: 1, _id: 1 })
      .toArray();
    return documents.map((document) =>
      fromStored<BreakGlassActivationRecord, "activationId">(
        document,
        "activationId",
      ),
    );
  }

  async listDueActivationIds(
    now: number,
    limit: number,
    session?: ClientSession,
  ): Promise<readonly string[]> {
    const documents = await this.activations
      .find(
        { status: "ACTIVE", expiresAt: { $lte: now } },
        { ...sessionOptions(session), projection: { _id: 1 } },
      )
      .sort({ expiresAt: 1, _id: 1 })
      .limit(limit)
      .toArray();
    return documents.map((item) => item._id);
  }

  async listPendingReviewActivationIds(
    now: number,
    limit: number,
    session?: ClientSession,
  ): Promise<readonly string[]> {
    const documents = await this.activations
      .find(
        {
          status: "EXPIRED",
          reviewerUserId: null,
          "independentReviewDeadline.dueAt": { $lte: now },
        },
        { ...sessionOptions(session), projection: { _id: 1 } },
      )
      .sort({ "independentReviewDeadline.dueAt": 1, _id: 1 })
      .limit(limit)
      .toArray();
    return documents.map((item) => item._id);
  }

  async insertExpiryEvidence(
    record: BreakGlassExpiryEvidenceRecord,
    session: ClientSession,
  ): Promise<BreakGlassExpiryEvidenceRecord> {
    await this.expiryEvidence.insertOne(toStored(record, "transitionId"), {
      session,
    });
    return record;
  }
}

interface GeneratedPrerequisiteDocument {
  readonly _id: string;
  readonly targetUserId: string;
  readonly sourceRoleAssignmentIds: readonly string[];
  readonly kind: "ACCOUNT_CONTEXT" | "RESPONSIBILITY";
  readonly value: string;
  readonly status: "ACTIVE" | "REVOKED";
}
interface ReconciliationUserDocument {
  readonly _id: string;
  readonly accountContexts?: readonly string[];
  readonly updatedAt?: number;
}

export class NativeMongoAccessAuthorityReconciliationRepository implements AccessAuthorityReconciliationRepository {
  private readonly assignments: Collection<
    Record<string, unknown> & { readonly _id: string }
  >;
  private readonly prerequisites: Collection<GeneratedPrerequisiteDocument>;
  private readonly users: Collection<ReconciliationUserDocument>;
  private readonly responsibilities: Collection<
    Record<string, unknown> & { readonly _id: string }
  >;
  private readonly bundleAssignments: Collection<
    Record<string, unknown> & { readonly _id: string }
  >;

  constructor(db: Db) {
    this.assignments = db.collection("role_assignments");
    this.prerequisites = db.collection("generated_access_prerequisites");
    this.users = db.collection("users");
    this.responsibilities = db.collection("responsibility_assignments");
    this.bundleAssignments = db.collection("bundle_assignments");
  }

  async addSuccessorSource(
    predecessorAssignmentId: string,
    successorAssignmentId: string,
    session: ClientSession,
  ): Promise<void> {
    await this.prerequisites.updateMany(
      { sourceRoleAssignmentIds: predecessorAssignmentId, status: "ACTIVE" },
      { $addToSet: { sourceRoleAssignmentIds: successorAssignmentId } },
      { session },
    );
  }

  async listActivePrerequisitesBySource(
    assignmentId: string,
    session: ClientSession,
  ): Promise<readonly GeneratedAccessPrerequisiteRecord[]> {
    const records = await this.prerequisites
      .find(
        { sourceRoleAssignmentIds: assignmentId, status: "ACTIVE" },
        { session },
      )
      .toArray();
    return records.map((record) => ({
      prerequisiteId: record._id,
      targetUserId: record.targetUserId,
      sourceRoleAssignmentIds: [...record.sourceRoleAssignmentIds],
      kind: record.kind,
      value: record.value,
    }));
  }

  async countActiveAssignments(
    assignmentIds: readonly string[],
    session: ClientSession,
  ): Promise<number> {
    return this.assignments.countDocuments(
      {
        _id: { $in: [...assignmentIds] },
        state: { $in: ["ACTIVE", "SCHEDULED"] },
      },
      { session, limit: 1 },
    );
  }

  async revokeGeneratedAccountContext(
    record: GeneratedAccessPrerequisiteRecord,
    now: number,
    session: ClientSession,
  ): Promise<boolean> {
    const result = await this.users.updateOne(
      { _id: record.targetUserId, accountContexts: record.value },
      { $pull: { accountContexts: record.value }, $set: { updatedAt: now } },
      { session },
    );
    return result.modifiedCount === 1;
  }

  async revokeGeneratedResponsibility(
    record: GeneratedAccessPrerequisiteRecord,
    actorId: string,
    now: number,
    session: ClientSession,
  ): Promise<boolean> {
    const result = await this.responsibilities.updateOne(
      { _id: record.value, status: "ACTIVE" },
      {
        $set: {
          status: "REVOKED",
          revokedAt: now,
          revokedBy: actorId,
          revokedReason: "SOURCE_ACCESS_REDUCED",
          updatedBy: actorId,
          updatedAt: now,
        },
      },
      { session },
    );
    return result.modifiedCount === 1;
  }

  async markPrerequisiteRevoked(
    prerequisiteId: string,
    now: number,
    session: ClientSession,
  ): Promise<boolean> {
    const result = await this.prerequisites.updateOne(
      { _id: prerequisiteId, status: "ACTIVE" },
      { $set: { status: "REVOKED", revokedAt: now } },
      { session },
    );
    return result.modifiedCount === 1;
  }

  async countActiveBundleChildren(
    bundleAssignmentId: string,
    session: ClientSession,
  ): Promise<number> {
    return this.assignments.countDocuments(
      {
        "bundleOrigin.bundleAssignmentId": bundleAssignmentId,
        state: { $in: ["ACTIVE", "SCHEDULED"] },
      },
      { session, limit: 1 },
    );
  }

  async revokeBundleParent(
    bundleAssignmentId: string,
    actorId: string,
    now: number,
    session: ClientSession,
  ): Promise<void> {
    await this.bundleAssignments.updateOne(
      { _id: bundleAssignmentId, status: "ACTIVE" },
      {
        $set: {
          status: "REVOKED",
          revokedAt: now,
          revokedBy: actorId,
          updatedAt: now,
        },
      },
      { session },
    );
  }
}

function toStored<T extends object, TIdKey extends keyof T>(
  record: T,
  idKey: TIdKey,
): Stored<T, TIdKey> {
  const { [idKey]: id, ...rest } = record;
  return { ...rest, _id: String(id) } as Stored<T, TIdKey>;
}

function fromStored<T extends object, TIdKey extends keyof T>(
  document: Stored<T, TIdKey>,
  idKey: TIdKey,
): T {
  const { _id, ...rest } = document;
  return { ...rest, [idKey]: _id } as unknown as T;
}
