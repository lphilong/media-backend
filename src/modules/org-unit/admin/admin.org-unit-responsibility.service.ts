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
import { OrgUnitManagerAssignmentRepository } from "@modules/kpi/domain/org-unit-manager-assignment.repository";
import {
  ORG_UNIT_MANAGER_ROLES,
  OrgUnitManagerAssignment,
  OrgUnitManagerAssignmentView,
  OrgUnitManagerRole,
} from "@modules/kpi/domain/kpi.types";
import {
  OrgUnitConflictError,
  OrgUnitNotFoundError,
  OrgUnitPermissionScopeError,
  OrgUnitStateError,
  OrgUnitValidationError,
} from "@modules/org-unit/domain/org-unit.errors";
import { OrgUnitRepository } from "@modules/org-unit/domain/org-unit.repository";
import { OrgUnitRecord } from "@modules/org-unit/domain/org-unit.types";
import {
  CreateOrgUnitResponsibilityCommand,
  ListOrgUnitResponsibilitiesQuery,
  ListOrgUnitResponsibilitiesResult,
  RevokeOrgUnitResponsibilityCommand,
  UpdateOrgUnitResponsibilityCommand,
} from "@modules/org-unit/shared/org-unit.contracts";
import { requireAdminObjectScopeAuthority } from "@modules/role/domain/admin-object-scope-authority";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";

const ASSIGN_RESPONSIBILITY_OPERATION: AuthoritativeAdminMutationIdentity =
  "org-unit.assign-responsibility";
const UPDATE_RESPONSIBILITY_OPERATION: AuthoritativeAdminMutationIdentity =
  "org-unit.update-responsibility";
const REVOKE_RESPONSIBILITY_OPERATION: AuthoritativeAdminMutationIdentity =
  "org-unit.revoke-responsibility";

const MANAGER_ACTIVE_STATUSES = ["ACTIVE", "ON_LEAVE"] as const;

interface NormalizedResponsibilityInput {
  readonly role: OrgUnitManagerRole;
  readonly includeDescendants: boolean;
  readonly effectiveFrom: number;
  readonly effectiveTo: number | null;
  readonly isPrimary: boolean;
}

interface NormalizedResponsibilityPatch {
  readonly role?: OrgUnitManagerRole;
  readonly includeDescendants?: boolean;
  readonly effectiveFrom?: number;
  readonly effectiveTo?: number | null;
  readonly isPrimary?: boolean;
}

export class OrgUnitResponsibilityAdminService {
  constructor(
    private readonly orgUnitRepository: OrgUnitRepository,
    private readonly assignmentRepository: OrgUnitManagerAssignmentRepository,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly structuredAuthority: StructuredScopeAuthorityService = createMissingStructuredAuthority(),
    private readonly clock: () => number = Date.now,
  ) {}

  async listResponsibilities(
    actor: Actor,
    query: ListOrgUnitResponsibilitiesQuery,
  ): Promise<ListOrgUnitResponsibilitiesResult> {
    this.assertPermission(actor, Permission.ORG_UNIT_READ);
    const orgUnitId = normalizeRequiredText(query.orgUnitId, "orgUnitId");
    const orgUnit = await this.requireOrgUnit(orgUnitId);
    await this.requireManagedOrgUnitAuthority(
      actor,
      Permission.ORG_UNIT_READ,
      orgUnit.id,
    );
    const assignments =
      await this.assignmentRepository.listAssignmentsByOrgUnitId(orgUnitId);

    return {
      items: await this.toViews(orgUnit, assignments),
    };
  }

  async createResponsibility(
    actor: Actor,
    command: CreateOrgUnitResponsibilityCommand,
  ): Promise<OrgUnitManagerAssignmentView> {
    const permission = this.assertPermission(actor, Permission.ORG_UNIT_UPDATE);
    const orgUnitId = normalizeRequiredText(command.orgUnitId, "orgUnitId");
    const managerEmploymentProfileId = normalizeRequiredText(
      command.managerEmploymentProfileId,
      "managerEmploymentProfileId",
    );
    const normalized = normalizeCreateCommand(command, this.clock());

    return this.executeMutation(
      actor,
      permission,
      ASSIGN_RESPONSIBILITY_OPERATION,
      `org-unit-responsibility:create:${orgUnitId}:${managerEmploymentProfileId}:${normalized.role}`,
      async (session) => {
        const orgUnit = await this.requireOrgUnit(orgUnitId, session);
        await this.requireManagedOrgUnitAuthority(
          actor,
          Permission.ORG_UNIT_UPDATE,
          orgUnit.id,
        );
        assertAssignableOrgUnit(orgUnit, orgUnitId);
        await this.assertManagerCandidate(managerEmploymentProfileId, session);

        const existing =
          await this.assignmentRepository.listAssignmentsByOrgUnitId(
            orgUnitId,
            session,
          );
        assertNoDuplicateOverlap(existing, {
          orgUnitId,
          managerEmploymentProfileId,
          role: normalized.role,
          effectiveFrom: normalized.effectiveFrom,
          effectiveTo: normalized.effectiveTo,
        });

        const now = this.clock();
        const assignment: OrgUnitManagerAssignment = {
          id: crypto.randomUUID(),
          orgUnitId,
          managerEmploymentProfileId,
          role: normalized.role,
          includeDescendants: normalized.includeDescendants,
          actionMask: [],
          effectiveFrom: normalized.effectiveFrom,
          effectiveTo: normalized.effectiveTo,
          status: "ACTIVE",
          isPrimary: normalized.isPrimary,
          createdAt: now,
          createdByActorId: actor.id,
          updatedAt: now,
          updatedByActorId: actor.id,
        };

        const created = await this.assignmentRepository.insertAssignment(
          assignment,
          session,
        );

        await this.audit.record(
          actor,
          permission,
          created.id,
          {
            mutationType: ASSIGN_RESPONSIBILITY_OPERATION,
            targetId: created.id,
            targetType: "org-unit-manager-assignment",
            orgUnitId,
            managerEmploymentProfileId,
            role: created.role,
          },
          session,
        );

        return this.toView(orgUnit, created);
      },
    );
  }

  async updateResponsibility(
    actor: Actor,
    command: UpdateOrgUnitResponsibilityCommand,
  ): Promise<OrgUnitManagerAssignmentView> {
    const permission = this.assertPermission(actor, Permission.ORG_UNIT_UPDATE);
    const orgUnitId = normalizeRequiredText(command.orgUnitId, "orgUnitId");
    const assignmentId = normalizeRequiredText(
      command.assignmentId,
      "assignmentId",
    );
    const patch = normalizePatchCommand(command);

    if (Object.keys(patch).length === 0) {
      throw new OrgUnitValidationError(
        "At least one field must be provided for responsibility update",
      );
    }

    return this.executeMutation(
      actor,
      permission,
      UPDATE_RESPONSIBILITY_OPERATION,
      `org-unit-responsibility:update:${orgUnitId}:${assignmentId}`,
      async (session) => {
        const orgUnit = await this.requireOrgUnit(orgUnitId, session);
        await this.requireManagedOrgUnitAuthority(
          actor,
          Permission.ORG_UNIT_UPDATE,
          orgUnit.id,
        );
        const current =
          await this.assignmentRepository.findAssignmentById(
            assignmentId,
            session,
          );
        if (!current || current.orgUnitId !== orgUnitId) {
          throw new OrgUnitNotFoundError(assignmentId);
        }
        if (current.status !== "ACTIVE") {
          throw new OrgUnitStateError(
            `Org unit responsibility is not ACTIVE: ${assignmentId}`,
          );
        }

        const nextEffectiveFrom =
          patch.effectiveFrom ?? current.effectiveFrom;
        const nextEffectiveTo =
          patch.effectiveTo !== undefined
            ? patch.effectiveTo
            : current.effectiveTo;
        assertEffectiveRange(nextEffectiveFrom, nextEffectiveTo);

        const nextRole = patch.role ?? current.role;
        const existing =
          await this.assignmentRepository.listAssignmentsByOrgUnitId(
            orgUnitId,
            session,
          );
        assertNoDuplicateOverlap(existing, {
          orgUnitId,
          managerEmploymentProfileId: current.managerEmploymentProfileId,
          role: nextRole,
          effectiveFrom: nextEffectiveFrom,
          effectiveTo: nextEffectiveTo,
          excludeAssignmentId: current.id,
        });

        const updated = await this.assignmentRepository.updateAssignment(
          {
            assignmentId,
            ...patch,
            updatedAt: this.clock(),
            updatedByActorId: actor.id,
          },
          session,
        );
        if (!updated) {
          throw new OrgUnitConflictError(
            `Org unit responsibility update conflict: ${assignmentId}`,
          );
        }

        await this.audit.record(
          actor,
          permission,
          updated.id,
          {
            mutationType: UPDATE_RESPONSIBILITY_OPERATION,
            targetId: updated.id,
            targetType: "org-unit-manager-assignment",
            orgUnitId,
            managerEmploymentProfileId: updated.managerEmploymentProfileId,
            role: updated.role,
          },
          session,
        );

        return this.toView(orgUnit, updated);
      },
    );
  }

  async revokeResponsibility(
    actor: Actor,
    command: RevokeOrgUnitResponsibilityCommand,
  ): Promise<OrgUnitManagerAssignmentView> {
    const permission = this.assertPermission(actor, Permission.ORG_UNIT_UPDATE);
    const orgUnitId = normalizeRequiredText(command.orgUnitId, "orgUnitId");
    const assignmentId = normalizeRequiredText(
      command.assignmentId,
      "assignmentId",
    );

    return this.executeMutation(
      actor,
      permission,
      REVOKE_RESPONSIBILITY_OPERATION,
      `org-unit-responsibility:revoke:${orgUnitId}:${assignmentId}`,
      async (session) => {
        const orgUnit = await this.requireOrgUnit(orgUnitId, session);
        await this.requireManagedOrgUnitAuthority(
          actor,
          Permission.ORG_UNIT_UPDATE,
          orgUnit.id,
        );
        const current =
          await this.assignmentRepository.findAssignmentById(
            assignmentId,
            session,
          );
        if (!current || current.orgUnitId !== orgUnitId) {
          throw new OrgUnitNotFoundError(assignmentId);
        }
        if (current.status !== "ACTIVE") {
          throw new OrgUnitStateError(
            `Org unit responsibility is not ACTIVE: ${assignmentId}`,
          );
        }

        const now = this.clock();
        const revoked = await this.assignmentRepository.revokeAssignment(
          {
            assignmentId,
            effectiveTo: now,
            updatedAt: now,
            updatedByActorId: actor.id,
          },
          session,
        );
        if (!revoked) {
          throw new OrgUnitConflictError(
            `Org unit responsibility revoke conflict: ${assignmentId}`,
          );
        }

        await this.audit.record(
          actor,
          permission,
          revoked.id,
          {
            mutationType: REVOKE_RESPONSIBILITY_OPERATION,
            targetId: revoked.id,
            targetType: "org-unit-manager-assignment",
            orgUnitId,
            managerEmploymentProfileId: revoked.managerEmploymentProfileId,
            previousStatus: current.status,
            nextStatus: revoked.status,
          },
          session,
        );

        return this.toView(orgUnit, revoked);
      },
    );
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

  private async requireOrgUnit(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<OrgUnitRecord> {
    const orgUnit = await this.orgUnitRepository.findById(orgUnitId, session);
    if (!orgUnit) {
      throw new OrgUnitNotFoundError(orgUnitId);
    }
    return orgUnit;
  }

  private async requireManagedOrgUnitAuthority(
    actor: Actor,
    permission: Permission,
    orgUnitId: string,
  ): Promise<void> {
    await requireAdminObjectScopeAuthority({
      actor,
      permission,
      scope: { scopeType: "managedOrgUnit", targetId: orgUnitId },
      authority: this.structuredAuthority,
      error: new OrgUnitPermissionScopeError(
        `Org unit responsibility requires managedOrgUnit scope: ${orgUnitId}`,
      ),
    });
  }

  private async assertManagerCandidate(
    managerEmploymentProfileId: string,
    session?: ClientSession,
  ): Promise<void> {
    const candidate =
      await this.assignmentRepository.findManagerEmploymentProfileCandidate(
        managerEmploymentProfileId,
        session,
      );
    if (!candidate) {
      throw new OrgUnitValidationError(
        `Manager employment profile does not exist: ${managerEmploymentProfileId}`,
      );
    }
    if (
      !MANAGER_ACTIVE_STATUSES.includes(
        candidate.employmentStatus as (typeof MANAGER_ACTIVE_STATUSES)[number],
      )
    ) {
      throw new OrgUnitValidationError(
        `Manager employment profile must be ACTIVE or ON_LEAVE: ${managerEmploymentProfileId}`,
      );
    }
  }

  private async toViews(
    orgUnit: OrgUnitRecord,
    assignments: readonly OrgUnitManagerAssignment[],
  ): Promise<readonly OrgUnitManagerAssignmentView[]> {
    const views: OrgUnitManagerAssignmentView[] = [];
    for (const assignment of assignments) {
      views.push(await this.toView(orgUnit, assignment));
    }
    return views;
  }

  private async toView(
    orgUnit: OrgUnitRecord,
    assignment: OrgUnitManagerAssignment,
  ): Promise<OrgUnitManagerAssignmentView> {
    const manager =
      await this.assignmentRepository.findManagerEmploymentProfileCandidate(
        assignment.managerEmploymentProfileId,
      );

    return {
      ...assignment,
      orgUnitRef: {
        id: orgUnit.id,
        code: orgUnit.code,
        name: orgUnit.name,
        status: orgUnit.status,
      },
      managerRef: {
        id: assignment.managerEmploymentProfileId,
        code: manager?.employeeCode,
        displayName: manager?.displayName,
        name: manager?.legalName,
        title: manager?.jobTitle,
        status: manager?.employmentStatus,
      },
    };
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

function normalizeCreateCommand(
  command: CreateOrgUnitResponsibilityCommand,
  now: number,
): NormalizedResponsibilityInput {
  const effectiveFrom = normalizeOptionalTimestamp(
    command.effectiveFrom,
    "effectiveFrom",
    now,
  );
  const effectiveTo = normalizeNullableTimestamp(
    command.effectiveTo,
    "effectiveTo",
  );
  assertEffectiveRange(effectiveFrom, effectiveTo);

  return {
    role: normalizeRole(command.role),
    includeDescendants: normalizeOptionalBoolean(
      command.includeDescendants,
      false,
      "includeDescendants",
    ),
    effectiveFrom,
    effectiveTo,
    isPrimary: normalizeOptionalBoolean(command.isPrimary, false, "isPrimary"),
  };
}

function normalizePatchCommand(
  command: UpdateOrgUnitResponsibilityCommand,
): NormalizedResponsibilityPatch {
  const patch: {
    role?: OrgUnitManagerRole;
    includeDescendants?: boolean;
    effectiveFrom?: number;
    effectiveTo?: number | null;
    isPrimary?: boolean;
  } = {};

  if (command.role !== undefined) {
    patch.role = normalizeRole(command.role);
  }
  if (command.includeDescendants !== undefined) {
    patch.includeDescendants = normalizeRequiredBoolean(
      command.includeDescendants,
      "includeDescendants",
    );
  }
  if (command.effectiveFrom !== undefined) {
    patch.effectiveFrom = normalizeRequiredTimestamp(
      command.effectiveFrom,
      "effectiveFrom",
    );
  }
  if (command.effectiveTo !== undefined) {
    patch.effectiveTo = normalizeNullableTimestamp(
      command.effectiveTo,
      "effectiveTo",
    );
  }
  if (command.isPrimary !== undefined) {
    patch.isPrimary = normalizeRequiredBoolean(command.isPrimary, "isPrimary");
  }

  return patch;
}

function normalizeRequiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new OrgUnitValidationError(`${field} is required`);
  }
  return value.trim();
}

function normalizeRole(value: unknown): OrgUnitManagerRole {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (ORG_UNIT_MANAGER_ROLES.includes(normalized as OrgUnitManagerRole)) {
      return normalized as OrgUnitManagerRole;
    }
  }
  throw new OrgUnitValidationError(
    `role must be one of ${ORG_UNIT_MANAGER_ROLES.join(", ")}`,
  );
}

function normalizeOptionalBoolean(
  value: unknown,
  fallback: boolean,
  field: string,
): boolean {
  if (value === undefined || value === null) {
    return fallback;
  }
  return normalizeRequiredBoolean(value, field);
}

function normalizeRequiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new OrgUnitValidationError(`${field} must be a boolean`);
  }
  return value;
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

function normalizeNullableTimestamp(
  value: unknown,
  field: string,
): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeRequiredTimestamp(value, field);
}

function normalizeRequiredTimestamp(value: unknown, field: string): number {
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value >= 0) {
      return value;
    }
    throw new OrgUnitValidationError(`${field} must be a valid timestamp`);
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) {
      throw new OrgUnitValidationError(`${field} must not be empty`);
    }
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
      ? Date.parse(`${normalized}T00:00:00.000Z`)
      : Date.parse(normalized);
    if (Number.isSafeInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  throw new OrgUnitValidationError(`${field} must be a valid timestamp`);
}

function assertEffectiveRange(
  effectiveFrom: number,
  effectiveTo: number | null,
): void {
  if (effectiveTo !== null && effectiveTo < effectiveFrom) {
    throw new OrgUnitValidationError(
      "effectiveTo must not be before effectiveFrom",
    );
  }
}

function assertAssignableOrgUnit(orgUnit: OrgUnitRecord, orgUnitId: string): void {
  if (orgUnit.status !== "ACTIVE") {
    throw new OrgUnitStateError(
      `Org unit responsibility requires ACTIVE org unit: ${orgUnitId}`,
    );
  }
}

function assertNoDuplicateOverlap(
  existing: readonly OrgUnitManagerAssignment[],
  candidate: {
    readonly orgUnitId: string;
    readonly managerEmploymentProfileId: string;
    readonly role: OrgUnitManagerRole;
    readonly effectiveFrom: number;
    readonly effectiveTo: number | null;
    readonly excludeAssignmentId?: string;
  },
): void {
  const duplicate = existing.find(
    (assignment) =>
      assignment.id !== candidate.excludeAssignmentId &&
      assignment.status === "ACTIVE" &&
      assignment.orgUnitId === candidate.orgUnitId &&
      assignment.managerEmploymentProfileId ===
        candidate.managerEmploymentProfileId &&
      assignment.role === candidate.role &&
      rangesOverlap(
        assignment.effectiveFrom,
        assignment.effectiveTo,
        candidate.effectiveFrom,
        candidate.effectiveTo,
      ),
  );

  if (duplicate) {
    throw new OrgUnitConflictError(
      `Active org unit responsibility already exists for ${candidate.orgUnitId}, ${candidate.managerEmploymentProfileId}, and ${candidate.role}`,
    );
  }
}

function rangesOverlap(
  leftFrom: number,
  leftTo: number | null,
  rightFrom: number,
  rightTo: number | null,
): boolean {
  const normalizedLeftTo = leftTo ?? Number.MAX_SAFE_INTEGER;
  const normalizedRightTo = rightTo ?? Number.MAX_SAFE_INTEGER;
  return leftFrom <= normalizedRightTo && rightFrom <= normalizedLeftTo;
}

function createMissingStructuredAuthority(): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService({
    async listByUserId(): Promise<never> {
      throw new OrgUnitPermissionScopeError(
        "Structured OrgUnit authority is unavailable",
      );
    },
  });
}
