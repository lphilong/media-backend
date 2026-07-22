import { ClientSession, Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository";
import {
  BusinessCodePolicy,
  parseGeneratedBusinessCodeSequence,
} from "@core/business-code/business-code-sequence.repository";
import {
  ReplaceRolePermissionsInput,
  RoleRepository,
  TransitionRoleStateInput,
  UpdateRoleMetadataInput,
} from "@modules/role/domain/role.repository";
import {
  RoleAssignmentRuleRepository,
  ReplaceRoleAssignmentRulesInput,
} from "@modules/role/domain/role-assignment-rule.repository";
import { UserRoleAssignmentRepository } from "@modules/role/domain/user-role-assignment.repository";
import { ActorScopeGrants } from "@core/actor/actor";
import {
  RoleAssignmentRuleRecord,
  RoleAssignmentState,
  RoleRecord,
  RoleState,
  UserRoleAssignmentRecord,
} from "@modules/role/domain/role.types";
import { isRoleTemplateCode } from "@modules/role/domain/role-template.catalog";
import { RoleAssignmentScopeGrant } from "@modules/role/domain/role-assignment-scope";

interface RoleDocument {
  readonly _id: string;
  readonly code: string;
  readonly name: string;
  readonly searchCode: string;
  readonly searchName: string;
  readonly description: string | null;
  readonly state: RoleState;
  readonly permissions: readonly string[];
  readonly delegationBand?: "LIMITED" | "PRIVILEGED" | "FOUNDATION";
  readonly maxDelegatableBand?: "NONE" | "LIMITED" | "PRIVILEGED";
  readonly templateCode?: string;
  readonly templateVersion?: string;
  readonly templateAppliedAt?: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly activatedAt: number | null;
  readonly archivedAt: number | null;
}

type RuntimeRoleRecordWithRawTemplateMetadata = Omit<
  RoleRecord,
  "templateCode"
> & {
  readonly templateCode?: string;
};

interface RoleAssignmentRuleDocument {
  readonly _id: string;
  readonly roleId: string;
  readonly code: string;
  readonly description: string | null;
  readonly state: "ACTIVE" | "INACTIVE";
  readonly conditions: Record<string, unknown> | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface UserRoleAssignmentDocument {
  readonly _id: string;
  readonly roleId: string;
  readonly userId: string;
  readonly scopeGrants?: ActorScopeGrants;
  readonly structuredScopeGrants?: readonly RoleAssignmentScopeGrant[];
  readonly scopeFingerprint?: string;
  readonly state: RoleAssignmentState;
  readonly effectiveAt: number | null;
  readonly expiresAt?: number | null;
  readonly reviewAt?: number | null;
  readonly lifecycle?: UserRoleAssignmentRecord["lifecycle"];
  readonly assignedBy?: string | null;
  readonly assignedAt?: number;
  readonly revokedAt: number | null;
  readonly revokedBy?: string | null;
  readonly revokeReason?: string | null;
  readonly origin?: "DIRECT" | "BUNDLE" | "LEGACY";
  readonly bundleOrigin?: UserRoleAssignmentRecord["bundleOrigin"];
  readonly reason: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export class NativeMongoRoleRepository
  extends BaseRepository<RoleDocument>
  implements RoleRepository
{
  constructor(db: Db) {
    super(db, "roles");
  }

  async insert(role: RoleRecord, session: ClientSession): Promise<RoleRecord> {
    await this.collection.insertOne(
      toRoleDocument(role),
      this.withSession(session),
    );

    return role;
  }

  async findById(
    roleId: string,
    session?: ClientSession,
  ): Promise<RoleRecord | null> {
    const doc = await this.collection.findOne(
      { _id: roleId },
      this.withSession(session),
    );

    return doc ? toRoleRecord(doc) : null;
  }

  async findByCode(
    code: string,
    session?: ClientSession,
  ): Promise<RoleRecord | null> {
    const doc = await this.collection.findOne(
      { code },
      this.withSession(session),
    );

    return doc ? toRoleRecord(doc) : null;
  }

  async findRawByCode(
    code: string,
    session?: ClientSession,
  ): Promise<RuntimeRoleRecordWithRawTemplateMetadata | null> {
    const doc = await this.collection.findOne(
      { code },
      this.withSession(session),
    );

    return doc ? toRoleRecordWithRawTemplateMetadata(doc) : null;
  }

  async findMaxGeneratedCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
    session: ClientSession,
  ): Promise<number> {
    const docs = await this.collection
      .find(
        {
          code: {
            $regex: `^${escapeRegExp(policy.prefix)}-\\d{${policy.width}}$`,
          },
        },
        {
          ...this.withSession(session),
          projection: { code: 1 },
        },
      )
      .toArray();

    return docs.reduce((max, doc) => {
      const sequence = parseGeneratedBusinessCodeSequence(doc.code, policy);
      return sequence !== null && sequence > max ? sequence : max;
    }, 0);
  }

  async updateMetadata(
    input: UpdateRoleMetadataInput,
    session: ClientSession,
  ): Promise<RoleRecord | null> {
    // Intentionally touch-capable: `updatedAt` is always required, while
    // `name` and `description` remain optional for timestamp-only refreshes.
    const set: Record<string, unknown> = {
      updatedAt: input.updatedAt,
    };

    if (input.name !== undefined) {
      set.name = input.name;
      set.searchName = normalizeSearchField(input.name);
    }

    if (input.description !== undefined) {
      set.description = input.description;
    }

    if (input.delegationBand !== undefined) {
      set.delegationBand = input.delegationBand;
    }

    if (input.maxDelegatableBand !== undefined) {
      set.maxDelegatableBand = input.maxDelegatableBand;
    }

    const updated = await this.collection.findOneAndUpdate(
      { _id: input.roleId },
      {
        $set: set,
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toRoleRecord(updated) : null;
  }

  async updateTemplateMetadata(
    input: {
      readonly roleId: string;
      readonly templateCode: string;
      readonly templateVersion: string;
      readonly templateAppliedAt: number;
      readonly updatedAt: number;
    },
    session: ClientSession,
  ): Promise<RuntimeRoleRecordWithRawTemplateMetadata | null> {
    const updated = await this.collection.findOneAndUpdate(
      { _id: input.roleId },
      {
        $set: {
          templateCode: input.templateCode,
          templateVersion: input.templateVersion,
          templateAppliedAt: input.templateAppliedAt,
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toRoleRecordWithRawTemplateMetadata(updated) : null;
  }

  async transitionState(
    input: TransitionRoleStateInput,
    session: ClientSession,
  ): Promise<RoleRecord | null> {
    const activatedAt =
      input.toState === "ACTIVE" ? input.changedAt : undefined;
    const archivedAt =
      input.toState === "ARCHIVED" ? input.changedAt : undefined;

    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.roleId,
        state: {
          $in: [...input.fromStates],
        },
      },
      {
        $set: {
          state: input.toState,
          updatedAt: input.changedAt,
          ...(activatedAt !== undefined ? { activatedAt } : {}),
          ...(archivedAt !== undefined ? { archivedAt } : {}),
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toRoleRecord(updated) : null;
  }

  async replacePermissions(
    input: ReplaceRolePermissionsInput,
    session: ClientSession,
  ): Promise<RoleRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      { _id: input.roleId },
      {
        $set: {
          permissions: [...input.permissions],
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toRoleRecord(updated) : null;
  }
}

export class NativeMongoRoleAssignmentRuleRepository
  extends BaseRepository<RoleAssignmentRuleDocument>
  implements RoleAssignmentRuleRepository
{
  constructor(db: Db) {
    super(db, "role_assignment_rules");
  }

  async replaceForRole(
    input: ReplaceRoleAssignmentRulesInput,
    session: ClientSession,
  ): Promise<readonly RoleAssignmentRuleRecord[]> {
    // Authoritative replace-all semantics: remove all prior rules, then
    // persist only the incoming replacement set for this role.
    await this.collection.deleteMany(
      { roleId: input.roleId },
      this.withSession(session),
    );

    if (input.rules.length > 0) {
      await this.collection.insertMany(
        input.rules.map((rule) => toRoleAssignmentRuleDocument(rule)),
        {
          ...this.withSession(session),
          ordered: true,
        },
      );
    }

    return [...input.rules];
  }

  async listByRoleId(
    roleId: string,
    session?: ClientSession,
  ): Promise<readonly RoleAssignmentRuleRecord[]> {
    const docs = await this.collection
      .find({ roleId }, this.withSession(session))
      .sort({ createdAt: 1, _id: 1 })
      .toArray();

    return docs.map((doc) => toRoleAssignmentRuleRecord(doc));
  }
}

export class NativeMongoUserRoleAssignmentRepository
  extends BaseRepository<UserRoleAssignmentDocument>
  implements UserRoleAssignmentRepository
{
  constructor(db: Db) {
    super(db, "role_assignments");
  }

  async insert(
    assignment: UserRoleAssignmentRecord,
    session: ClientSession,
  ): Promise<UserRoleAssignmentRecord> {
    await this.collection.insertOne(
      toUserRoleAssignmentDocument(assignment),
      this.withSession(session),
    );

    return assignment;
  }

  async findById(
    assignmentId: string,
    session?: ClientSession,
  ): Promise<UserRoleAssignmentRecord | null> {
    const doc = await this.collection.findOne(
      { _id: assignmentId },
      this.withSession(session),
    );

    return doc ? toUserRoleAssignmentRecord(doc) : null;
  }

  async findActiveByRoleAndUser(
    roleId: string,
    userId: string,
    session?: ClientSession,
  ): Promise<UserRoleAssignmentRecord | null> {
    const doc = await this.collection.findOne(
      {
        roleId,
        userId,
        state: { $in: ["ACTIVE", "SCHEDULED", "SUSPENDED"] },
      },
      this.withSession(session),
    );

    return doc ? toUserRoleAssignmentRecord(doc) : null;
  }

  async findActiveByRoleUserAndScopeFingerprint(
    roleId: string,
    userId: string,
    scopeFingerprint: string,
    session?: ClientSession,
  ): Promise<UserRoleAssignmentRecord | null> {
    const doc = await this.collection.findOne(
      {
        roleId,
        userId,
        scopeFingerprint,
        state: { $in: ["ACTIVE", "SCHEDULED", "SUSPENDED"] },
      },
      this.withSession(session),
    );
    return doc ? toUserRoleAssignmentRecord(doc) : null;
  }

  async findActiveManyByRoleAndUser(
    roleId: string,
    userId: string,
    session?: ClientSession,
  ): Promise<readonly UserRoleAssignmentRecord[]> {
    const docs = await this.collection
      .find(
        {
          roleId,
          userId,
          state: { $in: ["ACTIVE", "SCHEDULED", "SUSPENDED"] },
        },
        this.withSession(session),
      )
      .sort({ _id: 1 })
      .toArray();

    return docs.map((doc) => toUserRoleAssignmentRecord(doc));
  }

  async hasActiveAssignmentsForRole(
    roleId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    const doc = await this.collection.findOne(
      {
        roleId,
        state: { $in: ["ACTIVE", "SCHEDULED", "SUSPENDED"] },
      },
      {
        ...this.withSession(session),
        projection: { _id: 1 },
      },
    );

    return doc !== null;
  }

  async revokeById(
    assignmentId: string,
    reason: string | null,
    revokedAt: number,
    session: ClientSession,
    revokedBy?: string,
  ): Promise<UserRoleAssignmentRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: assignmentId,
        state: { $in: ["ACTIVE", "SCHEDULED", "SUSPENDED"] },
      },
      {
        $set: {
          state: "REVOKED",
          revokedAt,
          revokedBy: revokedBy ?? null,
          revokeReason: reason,
          updatedAt: revokedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toUserRoleAssignmentRecord(updated) : null;
  }

  async updateScopeGrants(
    assignmentId: string,
    scopeGrants: ActorScopeGrants,
    updatedAt: number,
    session: ClientSession,
  ): Promise<UserRoleAssignmentRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: assignmentId,
        state: "ACTIVE",
      },
      {
        $set: {
          scopeGrants,
          updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toUserRoleAssignmentRecord(updated) : null;
  }
}

function toRoleDocument(role: RoleRecord): RoleDocument {
  return {
    _id: role.id,
    code: role.code,
    name: role.name,
    searchCode: normalizeSearchField(role.code),
    searchName: normalizeSearchField(role.name),
    description: role.description,
    state: role.state,
    permissions: [...role.permissions],
    delegationBand: role.delegationBand,
    maxDelegatableBand: role.maxDelegatableBand,
    ...(role.templateCode ? { templateCode: role.templateCode } : {}),
    ...(role.templateVersion ? { templateVersion: role.templateVersion } : {}),
    ...(role.templateAppliedAt !== undefined
      ? { templateAppliedAt: role.templateAppliedAt }
      : {}),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
    activatedAt: role.activatedAt,
    archivedAt: role.archivedAt,
  };
}

function toRoleRecord(document: RoleDocument): RoleRecord {
  return {
    id: document._id,
    code: document.code,
    name: document.name,
    description: document.description,
    state: document.state,
    permissions: [...document.permissions],
    delegationBand: document.delegationBand ?? "LIMITED",
    maxDelegatableBand: document.maxDelegatableBand ?? "NONE",
    ...(typeof document.templateCode === "string" &&
    isRoleTemplateCode(document.templateCode)
      ? { templateCode: document.templateCode }
      : {}),
    ...(typeof document.templateVersion === "string"
      ? { templateVersion: document.templateVersion }
      : {}),
    ...(typeof document.templateAppliedAt === "number"
      ? {
          templateAppliedAt: document.templateAppliedAt,
        }
      : {}),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    activatedAt: document.activatedAt,
    archivedAt: document.archivedAt,
  };
}

function toRoleRecordWithRawTemplateMetadata(
  document: RoleDocument,
): RuntimeRoleRecordWithRawTemplateMetadata {
  return {
    id: document._id,
    code: document.code,
    name: document.name,
    description: document.description,
    state: document.state,
    permissions: [...document.permissions],
    delegationBand: document.delegationBand ?? "LIMITED",
    maxDelegatableBand: document.maxDelegatableBand ?? "NONE",
    ...(typeof document.templateCode === "string"
      ? { templateCode: document.templateCode }
      : {}),
    ...(typeof document.templateVersion === "string"
      ? { templateVersion: document.templateVersion }
      : {}),
    ...(typeof document.templateAppliedAt === "number"
      ? {
          templateAppliedAt: document.templateAppliedAt,
        }
      : {}),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    activatedAt: document.activatedAt,
    archivedAt: document.archivedAt,
  };
}

function normalizeSearchField(value: string): string {
  return value.trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function toRoleAssignmentRuleDocument(
  rule: RoleAssignmentRuleRecord,
): RoleAssignmentRuleDocument {
  return {
    _id: rule.id,
    roleId: rule.roleId,
    code: rule.code,
    description: rule.description,
    state: rule.state,
    conditions: rule.conditions,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

function toRoleAssignmentRuleRecord(
  document: RoleAssignmentRuleDocument,
): RoleAssignmentRuleRecord {
  return {
    id: document._id,
    roleId: document.roleId,
    code: document.code,
    description: document.description,
    state: document.state,
    conditions: document.conditions,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function toUserRoleAssignmentDocument(
  assignment: UserRoleAssignmentRecord,
): UserRoleAssignmentDocument {
  return {
    _id: assignment.assignmentId,
    roleId: assignment.roleId,
    userId: assignment.userId,
    ...(assignment.scopeGrants ? { scopeGrants: assignment.scopeGrants } : {}),
    ...(assignment.structuredScopeGrants
      ? { structuredScopeGrants: assignment.structuredScopeGrants }
      : {}),
    ...(assignment.scopeFingerprint
      ? { scopeFingerprint: assignment.scopeFingerprint }
      : {}),
    state: assignment.state,
    effectiveAt: assignment.effectiveAt,
    expiresAt: assignment.expiresAt ?? null,
    reviewAt: assignment.reviewAt ?? null,
    lifecycle: assignment.lifecycle ?? null,
    assignedBy: assignment.assignedBy ?? null,
    assignedAt: assignment.assignedAt ?? assignment.createdAt,
    revokedAt: assignment.revokedAt,
    revokedBy: assignment.revokedBy ?? null,
    revokeReason: assignment.revokeReason ?? null,
    origin: assignment.origin ?? "LEGACY",
    bundleOrigin: assignment.bundleOrigin ?? null,
    reason: assignment.reason,
    createdAt: assignment.createdAt,
    updatedAt: assignment.updatedAt,
  };
}

function toUserRoleAssignmentRecord(
  document: UserRoleAssignmentDocument,
): UserRoleAssignmentRecord {
  return {
    assignmentId: document._id,
    roleId: document.roleId,
    userId: document.userId,
    ...(document.scopeGrants ? { scopeGrants: document.scopeGrants } : {}),
    ...(document.structuredScopeGrants
      ? { structuredScopeGrants: document.structuredScopeGrants }
      : {}),
    ...(document.scopeFingerprint
      ? { scopeFingerprint: document.scopeFingerprint }
      : {}),
    state: document.state,
    effectiveAt: document.effectiveAt,
    expiresAt: document.expiresAt ?? null,
    reviewAt: document.reviewAt ?? null,
    lifecycle: document.lifecycle ?? null,
    assignedBy: document.assignedBy ?? null,
    assignedAt: document.assignedAt ?? document.createdAt,
    revokedAt: document.revokedAt,
    revokedBy: document.revokedBy ?? null,
    revokeReason: document.revokeReason ?? null,
    origin: document.origin ?? "LEGACY",
    bundleOrigin: document.bundleOrigin ?? null,
    reason: document.reason,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
