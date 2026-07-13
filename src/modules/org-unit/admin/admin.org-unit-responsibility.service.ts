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
  ORG_UNIT_MANAGER_ROLES,
  OrgUnitManagerAssignmentView,
  OrgUnitManagerRole,
} from "@modules/kpi/domain/kpi.types";
import {
  OrgUnitNotFoundError,
  OrgUnitPermissionScopeError,
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
import { ResponsibilityAdminService } from "@modules/responsibility/admin/admin.responsibility.service";
import { ResponsibilityAssignmentView } from "@modules/responsibility/domain/responsibility.types";

const ASSIGN_RESPONSIBILITY_OPERATION: AuthoritativeAdminMutationIdentity =
  "org-unit.assign-responsibility";
const UPDATE_RESPONSIBILITY_OPERATION: AuthoritativeAdminMutationIdentity =
  "org-unit.update-responsibility";
const REVOKE_RESPONSIBILITY_OPERATION: AuthoritativeAdminMutationIdentity =
  "org-unit.revoke-responsibility";

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
  private readonly responsibilityService: ResponsibilityAdminService | undefined;
  private readonly clock: () => number;

  constructor(
    private readonly orgUnitRepository: OrgUnitRepository,
    _legacyAssignmentRepository: unknown,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly structuredAuthority: StructuredScopeAuthorityService = createMissingStructuredAuthority(),
    responsibilityServiceOrClock?: ResponsibilityAdminService | (() => number),
    clock: () => number = Date.now,
  ) {
    this.responsibilityService =
      typeof responsibilityServiceOrClock === "function"
        ? undefined
        : responsibilityServiceOrClock;
    this.clock =
      typeof responsibilityServiceOrClock === "function"
        ? responsibilityServiceOrClock
        : clock;
  }

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
    const summary = await this.requireResponsibilityService().getSummaryForSubject(
      actor,
      "ORG_UNIT",
      orgUnitId,
    );
    return {
      items: summary.items
        .filter((item) => item.responsibilityType === "ORG_UNIT_MANAGER")
        .map(toOrgUnitManagerAssignmentView),
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
        const created =
          await this.requireResponsibilityService().createOrgUnitResponsibility(
            actor,
            {
              orgUnitId,
              managerEmploymentProfileId,
              role: normalized.role,
              includeDescendants: normalized.includeDescendants,
              effectiveFrom: normalized.effectiveFrom,
              effectiveTo: normalized.effectiveTo,
              isPrimary: normalized.isPrimary,
            },
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
            role: normalized.role,
          },
          session,
        );

        return toOrgUnitManagerAssignmentView(created);
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
        await this.assertCentralOrgUnitAssignment(actor, assignmentId, orgUnitId);
        const updated = await this.requireResponsibilityService().updateAssignment(
          actor,
          {
            assignmentId,
            responsibilityRole: patch.role,
            includeDescendants: patch.includeDescendants,
            effectiveAt: patch.effectiveFrom,
            expiresAt: patch.effectiveTo,
            isPrimary: patch.isPrimary,
          },
        );

        await this.audit.record(
          actor,
          permission,
          updated.id,
          {
            mutationType: UPDATE_RESPONSIBILITY_OPERATION,
            targetId: updated.id,
            targetType: "org-unit-manager-assignment",
            orgUnitId,
            managerEmploymentProfileId: updated.responsibleEmploymentProfileId,
            role: patch.role,
          },
          session,
        );

        return toOrgUnitManagerAssignmentView(updated);
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
        const current = await this.assertCentralOrgUnitAssignment(
          actor,
          assignmentId,
          orgUnitId,
        );
        const revoked = await this.requireResponsibilityService().revokeAssignment(
          actor,
          {
            assignmentId,
            reason: command.reason,
          },
        );

        await this.audit.record(
          actor,
          permission,
          revoked.id,
          {
            mutationType: REVOKE_RESPONSIBILITY_OPERATION,
            targetId: revoked.id,
            targetType: "org-unit-manager-assignment",
            orgUnitId,
            managerEmploymentProfileId: revoked.responsibleEmploymentProfileId,
            previousStatus: current.status,
            nextStatus: revoked.status,
            reason: revoked.revokedReason,
          },
          session,
        );

        return toOrgUnitManagerAssignmentView(revoked);
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

  private requireResponsibilityService(): ResponsibilityAdminService {
    if (!this.responsibilityService) {
      throw new OrgUnitValidationError(
        "OrgUnit responsibilities must use central responsibility assignments",
      );
    }
    return this.responsibilityService;
  }

  private async assertCentralOrgUnitAssignment(
    actor: Actor,
    assignmentId: string,
    orgUnitId: string,
  ): Promise<ResponsibilityAssignmentView> {
    const current = await this.requireResponsibilityService().getAssignment(
      actor,
      assignmentId,
    );
    if (
      current.subjectType !== "ORG_UNIT" ||
      current.subjectId !== orgUnitId ||
      current.responsibilityType !== "ORG_UNIT_MANAGER"
    ) {
      throw new OrgUnitNotFoundError(assignmentId);
    }
    return current;
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

function createMissingStructuredAuthority(): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService({
    async listByUserId(): Promise<never> {
      throw new OrgUnitPermissionScopeError(
        "Structured OrgUnit authority is unavailable",
      );
    },
  });
}

function toOrgUnitManagerAssignmentView(
  assignment: ResponsibilityAssignmentView,
): OrgUnitManagerAssignmentView {
  return {
    id: assignment.id,
    orgUnitId: assignment.subjectId,
    managerEmploymentProfileId: assignment.responsibleEmploymentProfileId,
    role:
      assignment.responsibilityRole === "DEPARTMENT_OWNER" ||
      assignment.responsibilityRole === "UNIT_OPERATOR"
        ? assignment.responsibilityRole
        : "UNIT_MANAGER",
    includeDescendants: assignment.includeDescendants ?? false,
    actionMask: assignment.actionMask,
    effectiveFrom: assignment.effectiveAt,
    effectiveTo: assignment.expiresAt,
    status: assignment.status === "ACTIVE" ? "ACTIVE" : "INACTIVE",
    isPrimary: assignment.isPrimary,
    createdAt: assignment.createdAt,
    createdByActorId: assignment.createdBy,
    updatedAt: assignment.updatedAt,
    updatedByActorId: assignment.updatedBy,
    orgUnitRef: assignment.subjectRef ?? {
      id: assignment.subjectId,
    },
    managerRef: assignment.responsibleEmploymentProfileRef ?? {
      id: assignment.responsibleEmploymentProfileId,
    },
  };
}
