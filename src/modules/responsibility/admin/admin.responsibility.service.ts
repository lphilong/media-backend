import crypto from "crypto";
import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import { AuthoritativeAdminMutationIdentity } from "@core/application/authoritative-admin-mutation.permission-map";
import { AuditGuard } from "@core/audit/audit.guard";
import { Permission } from "@core/permission/permission.enum";
import { PermissionContract } from "@core/permission/permission.contract";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import {
  ResponsibilityAssignmentFilters,
  ResponsibilityAssignmentRepository,
} from "@modules/responsibility/domain/responsibility.repository";
import {
  ResponsibilityConflictError,
  ResponsibilityNotFoundError,
  ResponsibilityPermissionScopeError,
  ResponsibilityStateError,
  ResponsibilityValidationError,
} from "@modules/responsibility/domain/responsibility.errors";
import {
  CreateResponsibilityAssignmentCommand,
  RESPONSIBILITY_SUBJECT_TYPES,
  RESPONSIBILITY_TYPES,
  ResponsibilityAssignmentListQuery,
  ResponsibilityAssignmentListResult,
  ResponsibilityAssignmentRecord,
  ResponsibilityAssignmentView,
  ResponsibilityStatus,
  ResponsibilitySubjectType,
  ResponsibilitySummaryResult,
  ResponsibilityType,
  RevokeResponsibilityAssignmentCommand,
  UpdateResponsibilityAssignmentCommand,
} from "@modules/responsibility/domain/responsibility.types";
import { RoleAssignmentScopeGrant } from "@modules/role/domain/role-assignment-scope";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";

export const RESPONSIBILITY_AUTHORITY_FIELDS = [
  "responsibilityRole",
  "includeDescendants",
  "actionMask",
  "isPrimary",
  "effectiveAt",
  "expiresAt",
] as const;

export class ResponsibilityAdminService {
  constructor(
    private readonly repository: ResponsibilityAssignmentRepository,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly structuredAuthority: StructuredScopeAuthorityService,
    private readonly clock: () => number = Date.now,
  ) {}

  async listAssignments(
    actor: Actor,
    query: ResponsibilityAssignmentListQuery,
  ): Promise<ResponsibilityAssignmentListResult> {
    PermissionGuard.assertAdminActor(actor);
    const normalizedQuery = normalizeListQuery(query, this.clock());
    if (normalizedQuery.subjectType) {
      this.assertPermission(
        actor,
        readPermissionForSubject(normalizedQuery.subjectType),
      );
    } else if (
      !RESPONSIBILITY_SUBJECT_TYPES.some((subjectType) =>
        actor.permissions.includes(readPermissionForSubject(subjectType)),
      )
    ) {
      this.assertPermission(actor, Permission.EMPLOYMENT_PROFILE_READ);
    }
    const authorizedSubjects = await this.listAuthorizedSubjects(
      actor,
      normalizedQuery.subjectType,
    );
    return {
      items: await this.repository.listNormalized({
        ...normalizedQuery,
        authorizedSubjects,
      }),
    };
  }

  async getAssignment(
    actor: Actor,
    assignmentId: string,
  ): Promise<ResponsibilityAssignmentView> {
    const assignment = await this.repository.findNormalizedById(
      normalizeRequiredText(assignmentId, "assignmentId"),
    );
    if (!assignment) {
      throw new ResponsibilityNotFoundError(assignmentId);
    }
    this.assertPermission(actor, readPermissionForSubject(assignment.subjectType));
    await this.requireSubjectAuthority(
      actor,
      assignment,
      readPermissionForSubject(assignment.subjectType),
      true,
    );
    return assignment;
  }

  async createAssignment(
    actor: Actor,
    command: CreateResponsibilityAssignmentCommand,
  ): Promise<ResponsibilityAssignmentView> {
    const normalized = normalizeCreateCommand(command, this.clock());
    const permission = this.assertPermission(
      actor,
      permissionForWrite(normalized.subjectType, normalized.responsibilityType),
    );
    await this.requireSubjectAuthority(
      actor,
      normalized,
      permissionForWrite(normalized.subjectType, normalized.responsibilityType),
    );

    return this.executeMutation(
      actor,
      permission,
      mutationIdentityFor("create", normalized.subjectType),
      `responsibility:create:${normalized.subjectType}:${normalized.subjectId}:${normalized.responsibleEmploymentProfileId}:${normalized.responsibilityType}`,
      async (session, controls) => {
        await this.assertReferencesAssignable(normalized, session);
        await this.assertNoDuplicatePrimary(normalized, session);

        const now = this.clock();
        const assignment: ResponsibilityAssignmentRecord = {
          id: crypto.randomUUID(),
          ...normalized,
          status: "ACTIVE",
          revokedAt: null,
          createdBy: actor.id,
          createdAt: now,
          updatedBy: actor.id,
          updatedAt: now,
          revokedBy: null,
          revokedReason: null,
          reviewNeeded: false,
          reviewReason: null,
        };

        const created = await this.repository.insert(assignment, session);
        await this.audit.record(
          actor,
          permission,
          created.id,
          {
            mutationType: mutationIdentityFor("create", created.subjectType),
            targetId: created.id,
            targetType: "responsibility-assignment",
            subjectType: created.subjectType,
            subjectId: created.subjectId,
            responsibleEmploymentProfileId:
              created.responsibleEmploymentProfileId,
            responsibilityType: created.responsibilityType,
            reason: created.reason,
          },
          session,
        );
        controls.markAuthSecurityTruthChanged();

        return this.requireView(created.id, session);
      },
    );
  }

  async updateAssignment(
    actor: Actor,
    command: UpdateResponsibilityAssignmentCommand,
  ): Promise<ResponsibilityAssignmentView> {
    const assignmentId = normalizeRequiredText(command.assignmentId, "assignmentId");
    const current = await this.repository.findNormalizedById(assignmentId);
    if (!current) {
      throw new ResponsibilityNotFoundError(assignmentId);
    }
    const permission = this.assertPermission(
      actor,
      permissionForWrite(current.subjectType, current.responsibilityType),
    );
    await this.requireSubjectAuthority(
      actor,
      current,
      permissionForWrite(current.subjectType, current.responsibilityType),
    );
    const patch = normalizeUpdateCommand(command);

    return this.executeMutation(
      actor,
      permission,
      mutationIdentityFor("update", current.subjectType),
      `responsibility:update:${assignmentId}`,
      async (session, controls) => {
        const transactionalCurrent =
          await this.repository.findNormalizedById(assignmentId, session);
        if (!transactionalCurrent) {
          throw new ResponsibilityConflictError(
            `Responsibility assignment update conflict: ${assignmentId}`,
          );
        }
        const authorityChanged = hasResponsibilityAuthorityFieldChange(
          transactionalCurrent,
          patch,
        );
        const updated = await this.repository.update(
          {
            assignmentId,
            ...patch,
            updatedAt: this.clock(),
            updatedBy: actor.id,
          },
          session,
        );
        if (!updated) {
          throw new ResponsibilityConflictError(
            `Responsibility assignment update conflict: ${assignmentId}`,
          );
        }
        await this.audit.record(
          actor,
          permission,
          updated.id,
          {
            mutationType: mutationIdentityFor("update", updated.subjectType),
            targetId: updated.id,
            targetType: "responsibility-assignment",
            subjectType: updated.subjectType,
            subjectId: updated.subjectId,
            responsibilityType: updated.responsibilityType,
          },
          session,
        );
        if (authorityChanged) {
          controls.markAuthSecurityTruthChanged();
        }
        return this.requireView(updated.id, session);
      },
    );
  }

  async revokeAssignment(
    actor: Actor,
    command: RevokeResponsibilityAssignmentCommand,
  ): Promise<ResponsibilityAssignmentView> {
    const assignmentId = normalizeRequiredText(command.assignmentId, "assignmentId");
    const current = await this.repository.findNormalizedById(assignmentId);
    if (!current) {
      throw new ResponsibilityNotFoundError(assignmentId);
    }
    const permission = this.assertPermission(
      actor,
      permissionForWrite(current.subjectType, current.responsibilityType),
    );
    await this.requireSubjectAuthority(
      actor,
      current,
      permissionForWrite(current.subjectType, current.responsibilityType),
    );
    const reason = normalizeRequiredText(command.reason, "reason");

    return this.executeMutation(
      actor,
      permission,
      mutationIdentityFor("revoke", current.subjectType),
      `responsibility:revoke:${assignmentId}`,
      async (session, controls) => {
        const revoked = await this.repository.revoke(
          {
            assignmentId,
            revokedAt: this.clock(),
            revokedBy: actor.id,
            revokedReason: reason,
          },
          session,
        );
        if (!revoked) {
          throw new ResponsibilityConflictError(
            `Responsibility assignment revoke conflict: ${assignmentId}`,
          );
        }
        await this.audit.record(
          actor,
          permission,
          revoked.id,
          {
            mutationType: mutationIdentityFor("revoke", revoked.subjectType),
            targetId: revoked.id,
            targetType: "responsibility-assignment",
            subjectType: revoked.subjectType,
            subjectId: revoked.subjectId,
            responsibilityType: revoked.responsibilityType,
            reason,
          },
          session,
        );
        controls.markAuthSecurityTruthChanged();
        return this.requireView(revoked.id, session);
      },
    );
  }

  async getSummaryForSubject(
    actor: Actor,
    subjectType: ResponsibilitySubjectType,
    subjectId: string,
  ): Promise<ResponsibilitySummaryResult> {
    this.assertPermission(actor, readPermissionForSubject(subjectType));
    await this.requireSubjectAuthority(
      actor,
      { subjectType, subjectId },
      readPermissionForSubject(subjectType),
      true,
    );
    const asOf = this.clock();
    const items = await this.repository.listNormalized({
      subjectType,
      subjectId,
      active: true,
      asOf,
    });
    const inherited =
      subjectType === "TALENT"
        ? await this.repository.listInheritedForTalent(subjectId, asOf)
        : subjectType === "EMPLOYMENT_PROFILE"
          ? await this.repository.listInheritedForEmploymentProfile(subjectId, asOf)
          : [];
    return { items, inherited };
  }

  async createTalentGroupManagerAssignment(
    actor: Actor,
    command: {
      readonly groupId: string;
      readonly managerEmploymentProfileId: string;
      readonly reason?: string | null;
    },
  ): Promise<ResponsibilityAssignmentView> {
    return this.createAssignment(actor, {
      subjectType: "TALENT_GROUP",
      subjectId: command.groupId,
      responsibleEmploymentProfileId: command.managerEmploymentProfileId,
      responsibilityType: "TALENT_GROUP_MANAGER",
      responsibilityRole: "MANAGER",
      isPrimary: true,
      reason: command.reason,
    });
  }

  async createOrgUnitResponsibility(
    actor: Actor,
    command: {
      readonly orgUnitId: string;
      readonly managerEmploymentProfileId: string;
      readonly role?: string;
      readonly includeDescendants?: boolean;
      readonly effectiveFrom?: number | string | null;
      readonly effectiveTo?: number | string | null;
      readonly isPrimary?: boolean;
    },
  ): Promise<ResponsibilityAssignmentView> {
    return this.createAssignment(actor, {
      subjectType: "ORG_UNIT",
      subjectId: command.orgUnitId,
      responsibleEmploymentProfileId: command.managerEmploymentProfileId,
      responsibilityType: "ORG_UNIT_MANAGER",
      responsibilityRole: command.role ?? "UNIT_MANAGER",
      includeDescendants: command.includeDescendants ?? false,
      effectiveAt: command.effectiveFrom,
      expiresAt: command.effectiveTo,
      isPrimary: command.isPrimary ?? false,
    });
  }

  async createTalentDirectManager(
    actor: Actor,
    command: {
      readonly talentId: string;
      readonly managerEmploymentProfileId: string;
    },
  ): Promise<ResponsibilityAssignmentView> {
    return this.createAssignment(actor, {
      subjectType: "TALENT",
      subjectId: command.talentId,
      responsibleEmploymentProfileId: command.managerEmploymentProfileId,
      responsibilityType: "TALENT_DIRECT_MANAGER",
      responsibilityRole: "DIRECT_EXCEPTION",
      isPrimary: true,
    });
  }

  async createEmploymentReportingManager(
    actor: Actor,
    command: {
      readonly employmentProfileId: string;
      readonly managerEmploymentProfileId: string;
    },
  ): Promise<ResponsibilityAssignmentView> {
    return this.createAssignment(actor, {
      subjectType: "EMPLOYMENT_PROFILE",
      subjectId: command.employmentProfileId,
      responsibleEmploymentProfileId: command.managerEmploymentProfileId,
      responsibilityType: "EMPLOYMENT_REPORTING_MANAGER",
      responsibilityRole: "HR_REPORTING",
      isPrimary: true,
    });
  }

  private async assertReferencesAssignable(
    input: NormalizedCreateResponsibility,
    session?: ClientSession,
  ): Promise<void> {
    const [subjectRef, responsibleRef] = await Promise.all([
      this.repository.findSubjectRef(input.subjectType, input.subjectId, session),
      this.repository.findEmploymentProfileRef(
        input.responsibleEmploymentProfileId,
        session,
      ),
    ]);
    if (!subjectRef) {
      throw new ResponsibilityValidationError(
        `Managed subject does not exist: ${input.subjectType}:${input.subjectId}`,
      );
    }
    if (!responsibleRef) {
      throw new ResponsibilityValidationError(
        `Responsible employment profile does not exist: ${input.responsibleEmploymentProfileId}`,
      );
    }
    if (
      responsibleRef.status !== "ACTIVE" &&
      responsibleRef.status !== "ON_LEAVE"
    ) {
      throw new ResponsibilityStateError(
        `Responsible employment profile must be ACTIVE or ON_LEAVE: ${input.responsibleEmploymentProfileId}`,
      );
    }
    if (["INACTIVE", "TERMINATED", "ARCHIVED", "SUSPENDED"].includes(subjectRef.status ?? "")) {
      throw new ResponsibilityStateError(
        `Managed subject must be active: ${input.subjectType}:${input.subjectId}`,
      );
    }
  }

  private async assertNoDuplicatePrimary(
    input: NormalizedCreateResponsibility,
    session?: ClientSession,
  ): Promise<void> {
    if (!input.isPrimary) {
      return;
    }
    const existing = await this.repository.listNormalized(
      {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        responsibilityType: input.responsibilityType,
        active: true,
        asOf: this.clock(),
      },
      session,
    );
    if (existing.some((assignment) => assignment.isPrimary)) {
      throw new ResponsibilityConflictError(
        `Active primary responsibility already exists for ${input.subjectType}:${input.subjectId}:${input.responsibilityType}`,
      );
    }
  }

  private async requireView(
    assignmentId: string,
    session?: ClientSession,
  ): Promise<ResponsibilityAssignmentView> {
    const view = await this.repository.findNormalizedById(assignmentId, session);
    if (!view) {
      throw new ResponsibilityNotFoundError(assignmentId);
    }
    return view;
  }

  private assertPermission(
    actor: Actor,
    permissionCode: Permission,
  ): PermissionContract {
    const permission = PermissionResolver.resolve(permissionCode);
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);
    return permission;
  }

  private async listAuthorizedSubjects(
    actor: Actor,
    requestedSubjectType?: ResponsibilitySubjectType,
  ): Promise<readonly AuthorizedResponsibilitySubject[]> {
    if (!actor.isActive) {
      return [];
    }
    const subjectTypes = requestedSubjectType
      ? [requestedSubjectType]
      : [...RESPONSIBILITY_SUBJECT_TYPES];
    const authorized = await Promise.all(
      subjectTypes.map(async (subjectType) => {
        const permission = readPermissionForSubject(subjectType);
        if (!actor.permissions.includes(permission)) {
          return [];
        }
        const grants = await this.structuredAuthority.listAuthorizedScopeGrants({
          userId: actor.id,
          permission,
        });
        return authorizedSubjectsFor(subjectType, grants);
      }),
    );
    return authorized.flat();
  }

  private async requireSubjectAuthority(
    actor: Actor,
    subject: Pick<ResponsibilityAssignmentView, "subjectType" | "subjectId">,
    permission: Permission,
    concealExistence = false,
  ): Promise<void> {
    const grants = await this.structuredAuthority.listAuthorizedScopeGrants({
      userId: actor.id,
      permission,
    });
    const authorized = authorizedSubjectsFor(subject.subjectType, grants).some(
      (candidate) =>
        candidate.subjectType === subject.subjectType &&
        (candidate.subjectId === undefined || candidate.subjectId === subject.subjectId),
    );
    if (!actor.isActive || !authorized) {
      if (concealExistence) {
        throw new ResponsibilityNotFoundError(subject.subjectId);
      }
      throw new ResponsibilityPermissionScopeError();
    }
  }

  private async executeMutation<T>(
    actor: Actor,
    permission: PermissionContract,
    operation: AuthoritativeAdminMutationIdentity,
    targetDescriptor: string,
    fn: (
      session: ClientSession,
      controls: AuthoritativeMutationControls,
    ) => Promise<T>,
  ): Promise<T> {
    return this.mutationBridge.execute(
      {
        actor,
        traceId: getTraceIdOrThrow(),
        requiredPermission: permission,
        mutationIdentity: operation,
        mutationTargetDescriptor: targetDescriptor,
      },
      fn,
    );
  }
}

interface NormalizedCreateResponsibility {
  readonly subjectType: ResponsibilitySubjectType;
  readonly subjectId: string;
  readonly responsibleEmploymentProfileId: string;
  readonly responsibilityType: ResponsibilityType;
  readonly responsibilityRole: string | null;
  readonly includeDescendants: boolean | null;
  readonly actionMask: readonly string[];
  readonly isPrimary: boolean;
  readonly effectiveAt: number;
  readonly expiresAt: number | null;
  readonly reason: string | null;
}

interface NormalizedUpdateResponsibility {
  readonly responsibilityRole?: string | null;
  readonly includeDescendants?: boolean | null;
  readonly actionMask?: readonly string[];
  readonly isPrimary?: boolean;
  readonly effectiveAt?: number;
  readonly expiresAt?: number | null;
  readonly reason?: string | null;
}

interface AuthorizedResponsibilitySubject {
  readonly subjectType: ResponsibilitySubjectType;
  readonly subjectId?: string;
}

function hasResponsibilityAuthorityFieldChange(
  current: ResponsibilityAssignmentView,
  patch: NormalizedUpdateResponsibility,
): boolean {
  return (
    (patch.responsibilityRole !== undefined &&
      patch.responsibilityRole !== current.responsibilityRole) ||
    (patch.includeDescendants !== undefined &&
      patch.includeDescendants !== current.includeDescendants) ||
    (patch.actionMask !== undefined &&
      !sameAuthorityStringSet(patch.actionMask, current.actionMask)) ||
    (patch.isPrimary !== undefined && patch.isPrimary !== current.isPrimary) ||
    (patch.effectiveAt !== undefined &&
      patch.effectiveAt !== current.effectiveAt) ||
    (patch.expiresAt !== undefined && patch.expiresAt !== current.expiresAt)
  );
}

function sameAuthorityStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const normalize = (values: readonly string[]) =>
    [...new Set(values)].sort().join("\n");
  return normalize(left) === normalize(right);
}

function authorizedSubjectsFor(
  subjectType: ResponsibilitySubjectType,
  grants: readonly RoleAssignmentScopeGrant[],
): readonly AuthorizedResponsibilitySubject[] {
  if (grants.some((grant) => grant.scopeType === "global")) {
    return [{ subjectType }];
  }
  const expectedScope =
    subjectType === "TALENT_GROUP"
      ? "managedTalentGroup"
      : subjectType === "ORG_UNIT"
        ? "managedOrgUnit"
        : null;
  if (!expectedScope) {
    return [];
  }
  return grants
    .filter(
      (grant) => grant.scopeType === expectedScope && Boolean(grant.targetId),
    )
    .map((grant) => ({ subjectType, subjectId: grant.targetId! }));
}

function normalizeListQuery(
  query: ResponsibilityAssignmentListQuery,
  now: number,
): ResponsibilityAssignmentFilters {
  return {
    responsibleEmploymentProfileId: normalizeOptionalId(
      query.responsibleEmploymentProfileId,
      "responsibleEmploymentProfileId",
    ),
    subjectType: normalizeOptionalSubjectType(query.subjectType),
    subjectId: normalizeOptionalId(query.subjectId, "subjectId"),
    responsibilityType: normalizeOptionalResponsibilityType(
      query.responsibilityType,
    ),
    status: normalizeOptionalStatus(query.status),
    active: normalizeOptionalActive(query.active),
    limit: normalizeLimit(query.limit),
    asOf: now,
  };
}

function normalizeCreateCommand(
  command: CreateResponsibilityAssignmentCommand,
  now: number,
): NormalizedCreateResponsibility {
  const subjectType = normalizeSubjectType(command.subjectType);
  const responsibilityType = normalizeResponsibilityType(
    command.responsibilityType,
  );
  assertSubjectTypeMatchesResponsibilityType(subjectType, responsibilityType);
  const effectiveAt = normalizeOptionalTimestamp(
    command.effectiveAt,
    "effectiveAt",
    now,
  );
  const expiresAt = normalizeNullableTimestamp(command.expiresAt, "expiresAt");
  assertEffectiveRange(effectiveAt, expiresAt);

  return {
    subjectType,
    subjectId: normalizeRequiredText(command.subjectId, "subjectId"),
    responsibleEmploymentProfileId: normalizeRequiredText(
      command.responsibleEmploymentProfileId,
      "responsibleEmploymentProfileId",
    ),
    responsibilityType,
    responsibilityRole: normalizeNullableText(
      command.responsibilityRole,
      "responsibilityRole",
    ),
    includeDescendants:
      command.includeDescendants === undefined
        ? null
        : normalizeNullableBoolean(command.includeDescendants, "includeDescendants"),
    actionMask: normalizeActionMask(command.actionMask),
    isPrimary: command.isPrimary ?? false,
    effectiveAt,
    expiresAt,
    reason: normalizeNullableText(command.reason, "reason"),
  };
}

function normalizeUpdateCommand(
  command: UpdateResponsibilityAssignmentCommand,
): NormalizedUpdateResponsibility {
  const patch: {
    responsibilityRole?: string | null;
    includeDescendants?: boolean | null;
    actionMask?: readonly string[];
    isPrimary?: boolean;
    effectiveAt?: number;
    expiresAt?: number | null;
    reason?: string | null;
  } = {};
  if (command.responsibilityRole !== undefined) {
    patch.responsibilityRole = normalizeNullableText(
      command.responsibilityRole,
      "responsibilityRole",
    );
  }
  if (command.includeDescendants !== undefined) {
    patch.includeDescendants = normalizeNullableBoolean(
      command.includeDescendants,
      "includeDescendants",
    );
  }
  if (command.actionMask !== undefined) {
    patch.actionMask = normalizeActionMask(command.actionMask);
  }
  if (command.isPrimary !== undefined) {
    patch.isPrimary = normalizeRequiredBoolean(command.isPrimary, "isPrimary");
  }
  if (command.effectiveAt !== undefined) {
    patch.effectiveAt = normalizeRequiredTimestamp(command.effectiveAt, "effectiveAt");
  }
  if (command.expiresAt !== undefined) {
    patch.expiresAt = normalizeNullableTimestamp(command.expiresAt, "expiresAt");
  }
  if (command.reason !== undefined) {
    patch.reason = normalizeNullableText(command.reason, "reason");
  }
  if (Object.keys(patch).length === 0) {
    throw new ResponsibilityValidationError(
      "At least one field must be provided for responsibility update",
    );
  }
  return patch;
}

function normalizeSubjectType(value: unknown): ResponsibilitySubjectType {
  if (
    typeof value === "string" &&
    RESPONSIBILITY_SUBJECT_TYPES.includes(value as ResponsibilitySubjectType)
  ) {
    return value as ResponsibilitySubjectType;
  }
  throw new ResponsibilityValidationError(
    `subjectType must be one of ${RESPONSIBILITY_SUBJECT_TYPES.join(", ")}`,
  );
}

function normalizeOptionalSubjectType(
  value: unknown,
): ResponsibilitySubjectType | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return normalizeSubjectType(value);
}

function normalizeResponsibilityType(value: unknown): ResponsibilityType {
  if (
    typeof value === "string" &&
    RESPONSIBILITY_TYPES.includes(value as ResponsibilityType)
  ) {
    return value as ResponsibilityType;
  }
  throw new ResponsibilityValidationError(
    `responsibilityType must be one of ${RESPONSIBILITY_TYPES.join(", ")}`,
  );
}

function normalizeOptionalResponsibilityType(
  value: unknown,
): ResponsibilityType | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return normalizeResponsibilityType(value);
}

function normalizeOptionalStatus(value: unknown): ResponsibilityStatus | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "ACTIVE" || value === "INACTIVE" || value === "REVOKED") {
    return value;
  }
  throw new ResponsibilityValidationError("status is invalid");
}

function normalizeOptionalActive(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new ResponsibilityValidationError("active must be true or false");
}

function normalizeOptionalId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return normalizeRequiredText(value, field);
}

function normalizeRequiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ResponsibilityValidationError(`${field} is required`);
  }
  return value.trim();
}

function normalizeNullableText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new ResponsibilityValidationError(`${field} must be a string`);
  }
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function normalizeNullableBoolean(value: unknown, field: string): boolean | null {
  if (value === null) {
    return null;
  }
  return normalizeRequiredBoolean(value, field);
}

function normalizeRequiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new ResponsibilityValidationError(`${field} must be a boolean`);
  }
  return value;
}

function normalizeActionMask(value: unknown): readonly string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new ResponsibilityValidationError("actionMask must be a string array");
  }
  return value.map((entry) => entry.trim()).filter(Boolean);
}

function normalizeLimit(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1 || numeric > 200) {
    throw new ResponsibilityValidationError("limit must be between 1 and 200");
  }
  return numeric;
}

function normalizeOptionalTimestamp(
  value: unknown,
  field: string,
  fallback: number,
): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  return normalizeRequiredTimestamp(value, field);
}

function normalizeNullableTimestamp(value: unknown, field: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeRequiredTimestamp(value, field);
}

function normalizeRequiredTimestamp(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? Date.parse(`${value}T00:00:00.000Z`)
      : Date.parse(value);
    if (Number.isSafeInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  throw new ResponsibilityValidationError(`${field} must be a valid timestamp`);
}

function assertEffectiveRange(effectiveAt: number, expiresAt: number | null): void {
  if (expiresAt !== null && expiresAt < effectiveAt) {
    throw new ResponsibilityValidationError("expiresAt must not be before effectiveAt");
  }
}

function assertSubjectTypeMatchesResponsibilityType(
  subjectType: ResponsibilitySubjectType,
  responsibilityType: ResponsibilityType,
): void {
  const expected: Record<ResponsibilityType, ResponsibilitySubjectType> = {
    TALENT_GROUP_MANAGER: "TALENT_GROUP",
    ORG_UNIT_MANAGER: "ORG_UNIT",
    TALENT_DIRECT_MANAGER: "TALENT",
    EMPLOYMENT_REPORTING_MANAGER: "EMPLOYMENT_PROFILE",
  };
  if (expected[responsibilityType] !== subjectType) {
    throw new ResponsibilityValidationError(
      `${responsibilityType} requires subjectType ${expected[responsibilityType]}`,
    );
  }
}

function permissionForWrite(
  subjectType: ResponsibilitySubjectType,
  responsibilityType: ResponsibilityType,
): Permission {
  if (subjectType === "TALENT_GROUP") return Permission.TALENT_GROUP_UPDATE;
  if (subjectType === "ORG_UNIT") return Permission.ORG_UNIT_UPDATE;
  if (responsibilityType === "TALENT_DIRECT_MANAGER") return Permission.TALENT_MANAGE_MANAGER;
  return Permission.EMPLOYMENT_PROFILE_MANAGE_MANAGER_ASSIGNMENT;
}

function mutationIdentityFor(
  operation: "create" | "update" | "revoke",
  subjectType: ResponsibilitySubjectType,
): AuthoritativeAdminMutationIdentity {
  if (subjectType === "TALENT_GROUP") {
    return operation === "revoke"
      ? "talent-group.revoke-manager"
      : "talent-group.assign-manager";
  }
  if (subjectType === "ORG_UNIT") {
    if (operation === "create") return "org-unit.assign-responsibility";
    if (operation === "update") return "org-unit.update-responsibility";
    return "org-unit.revoke-responsibility";
  }
  if (subjectType === "TALENT") {
    return "talent.assign-manager";
  }
  return "employment-profile.assign-manager";
}

function readPermissionForSubject(subjectType: ResponsibilitySubjectType): Permission {
  if (subjectType === "TALENT_GROUP") return Permission.TALENT_GROUP_READ;
  if (subjectType === "ORG_UNIT") return Permission.ORG_UNIT_READ;
  if (subjectType === "TALENT") return Permission.TALENT_READ;
  return Permission.EMPLOYMENT_PROFILE_READ;
}
