import crypto from "crypto";
import {
  ClientSession,
  MongoServerError,
} from "mongodb";
import { Actor } from "@core/actor/actor";
import {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import { AuthoritativeAdminMutationIdentity } from "@core/application/authoritative-admin-mutation.permission-map";
import { AuditGuard } from "@core/audit/audit.guard";
import { SystemInvariantError } from "@core/error/system-error";
import { BaseAppError } from "@core/errors/base.error";
import { Permission } from "@core/permission/permission.enum";
import { PermissionContract } from "@core/permission/permission.contract";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import {
  createStructuredLogger,
  StructuredLogger,
} from "@infra/logger.adapter";
import {
  OrgUnitConflictError,
  OrgUnitHierarchyCycleError,
  OrgUnitNotFoundError,
  OrgUnitParentStateError,
  OrgUnitStateError,
  OrgUnitValidationError,
} from "@modules/org-unit/domain/org-unit.errors";
import {
  OrgUnitRepository,
  RewriteOrgUnitHierarchyDescendantInput,
  UpdateOrgUnitProfileInput,
} from "@modules/org-unit/domain/org-unit.repository";
import { OrgUnitEmploymentReadonlyAccess } from "@modules/org-unit/domain/org-unit-employment-readonly-access";
import { OrgUnitPlatformAccountReadonlyAccess } from "@modules/org-unit/domain/org-unit-platform-account-readonly-access";
import {
  ORG_UNIT_STATUSES,
  ORG_UNIT_TYPES,
  OrgUnitMutationView,
  OrgUnitRecord,
  OrgUnitStatus,
  OrgUnitType,
} from "@modules/org-unit/domain/org-unit.types";
import {
  ActivateOrgUnitCommand,
  ArchiveOrgUnitCommand,
  CreateOrgUnitCommand,
  DeactivateOrgUnitCommand,
  MoveOrgUnitCommand,
  OrgUnitMutationResult,
  UpdateOrgUnitProfileCommand,
} from "@modules/org-unit/shared/org-unit.contracts";

type OrgUnitFailureClassification =
  | "validation"
  | "conflict"
  | "not_found"
  | "state_error"
  | "parent_state"
  | "hierarchy_cycle"
  | "invariant"
  | "unknown";

export class OrgUnitAdminService {
  constructor(
    private readonly repository: OrgUnitRepository,
    private readonly employmentReadonlyAccess: OrgUnitEmploymentReadonlyAccess,
    private readonly platformAccountReadonlyAccess: OrgUnitPlatformAccountReadonlyAccess,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly logger: StructuredLogger = createStructuredLogger(),
  ) {}

  async createOrgUnit(
    actor: Actor,
    command: CreateOrgUnitCommand,
  ): Promise<OrgUnitMutationResult> {
    const operation = "org-unit.create";
    const permission = this.assertPermission(
      actor,
      Permission.ORG_UNIT_CREATE,
    );
    const input = normalizeCreateCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        code: readOptionalLogString(command.code),
        type: readOptionalLogString(command.type),
        parentOrgUnitId:
          readOptionalLogString(
            command.parentOrgUnitId,
          ) ?? undefined,
      },
      async (session) => {
        const existingCode =
          await this.repository.findByCode(
            input.code,
            session,
          );

        if (existingCode) {
          throw new OrgUnitConflictError(
            `Org unit code already exists: ${input.code}`,
          );
        }

        let ancestorChain: readonly string[] = [];

        if (input.parentOrgUnitId) {
          const parent =
            await this.requireOrgUnit(
              input.parentOrgUnitId,
              session,
            );
          assertHierarchyRecordInvariant(
            parent,
            "parent org unit",
          );
          assertParentActive(
            parent,
            input.parentOrgUnitId,
          );

          ancestorChain = [
            ...parent.ancestorChain,
            parent.id,
          ];
        }

        const siblingConflict =
          await this.repository.findLiveSiblingByNormalizedName(
            {
              parentOrgUnitId:
                input.parentOrgUnitId,
              normalizedName:
                input.normalizedName,
            },
            session,
          );

        if (siblingConflict) {
          throw new OrgUnitConflictError(
            "A live sibling org unit already uses the same normalized name",
          );
        }

        const now = Date.now();
        const record: OrgUnitRecord = {
          id: crypto.randomUUID(),
          code: input.code,
          searchCode: normalizeSearchCode(
            input.code,
          ),
          name: input.name,
          normalizedName:
            input.normalizedName,
          type: input.type,
          status: "ACTIVE",
          parentOrgUnitId: input.parentOrgUnitId,
          ancestorChain,
          depth: ancestorChain.length,
          displayOrder: input.displayOrder,
          description: input.description,
          externalRef: input.externalRef,
          createdAt: now,
          updatedAt: now,
        };

        let created: OrgUnitRecord;

        try {
          created = await this.repository.insert(
            record,
            session,
          );
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            throw new OrgUnitConflictError(
              "Org unit code or sibling normalized name already exists",
            );
          }

          throw error;
        }

        await this.recordAudit({
          actor,
          permission,
          orgUnitId: created.id,
          mutationType: operation,
          metadata: {
            orgUnitCode: created.code,
            parentOrgUnitId:
              created.parentOrgUnitId,
            orgUnitType: created.type,
          },
          session,
        });

        return toOrgUnitMutationView(created);
      },
      (result) => ({
        orgUnitId: result.id,
        parentOrgUnitId: result.parentOrgUnitId,
        status: result.status,
      }),
    );
  }

  async updateOrgUnitProfile(
    actor: Actor,
    command: UpdateOrgUnitProfileCommand,
  ): Promise<OrgUnitMutationResult> {
    const operation = "org-unit.update";
    const permission = this.assertPermission(
      actor,
      Permission.ORG_UNIT_UPDATE,
    );
    const orgUnitId = normalizeRequiredText(
      command.orgUnitId,
      "orgUnitId",
    );

    const hasName = command.name !== undefined;
    const hasDescription =
      command.description !== undefined;
    const hasDisplayOrder =
      command.displayOrder !== undefined;
    const hasExternalRef =
      command.externalRef !== undefined;

    if (
      !hasName &&
      !hasDescription &&
      !hasDisplayOrder &&
      !hasExternalRef
    ) {
      throw new OrgUnitValidationError(
        "At least one field must be provided for update",
      );
    }

    const normalizedName = hasName
      ? normalizeRequiredText(
          command.name,
          "name",
        )
      : undefined;
    const description = hasDescription
      ? normalizeNullablePatchText(
          command.description,
          "description",
        )
      : undefined;
    const displayOrder = hasDisplayOrder
      ? normalizeInteger(
          command.displayOrder,
          "displayOrder",
        )
      : undefined;
    const externalRef = hasExternalRef
      ? normalizeNullablePatchText(
          command.externalRef,
          "externalRef",
        )
      : undefined;

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        orgUnitId: readOptionalLogString(
          command.orgUnitId,
        ),
      },
      async (session) => {
        const current =
          await this.requireOrgUnit(
            orgUnitId,
            session,
          );
        assertHierarchyRecordInvariant(
          current,
          "org unit",
        );

        if (current.status === "ARCHIVED") {
          throw new OrgUnitStateError(
            `Archived org unit cannot be updated: ${orgUnitId}`,
          );
        }

        const patch =
          buildOrgUnitProfilePatch({
            current,
            name: normalizedName,
            description,
            displayOrder,
            externalRef,
            orgUnitId,
          });

        const changedFields = Object.keys(
          patch,
        ).filter((field) => field !== "updatedAt");

        if (changedFields.length === 0) {
          throw new OrgUnitValidationError(
            "At least one changed field is required",
          );
        }

        if (patch.normalizedName !== undefined) {
          const siblingConflict =
            await this.repository.findLiveSiblingByNormalizedName(
              {
                parentOrgUnitId:
                  current.parentOrgUnitId,
                normalizedName:
                  patch.normalizedName,
                excludeOrgUnitId: current.id,
              },
              session,
            );

          if (siblingConflict) {
            throw new OrgUnitConflictError(
              "A live sibling org unit already uses the same normalized name",
            );
          }
        }

        let updated: OrgUnitRecord | null;

        try {
          updated =
            await this.repository.updateProfile(
              patch,
              session,
            );
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            throw new OrgUnitConflictError(
              "A live sibling org unit already uses the same normalized name",
            );
          }

          throw error;
        }

        if (!updated) {
          throw new OrgUnitConflictError(
            `Failed to update org unit: ${orgUnitId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          orgUnitId,
          mutationType: operation,
          metadata: {
            changedFields,
          },
          session,
        });

        return toOrgUnitMutationView(updated);
      },
      (result) => ({
        orgUnitId: result.id,
        status: result.status,
      }),
    );
  }

  async moveOrgUnit(
    actor: Actor,
    command: MoveOrgUnitCommand,
  ): Promise<OrgUnitMutationResult> {
    const operation = "org-unit.move";
    const permission = this.assertPermission(
      actor,
      Permission.ORG_UNIT_MANAGE_HIERARCHY,
    );
    const orgUnitId = normalizeRequiredText(
      command.orgUnitId,
      "orgUnitId",
    );
    const newParentOrgUnitId =
      normalizeRequiredNullableId(
        command.newParentOrgUnitId,
        "newParentOrgUnitId",
      );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        orgUnitId: readOptionalLogString(
          command.orgUnitId,
        ),
        requestedParentOrgUnitId:
          newParentOrgUnitId ?? undefined,
      },
      async (session, controls) => {
        const current =
          await this.requireOrgUnit(
            orgUnitId,
            session,
          );
        assertHierarchyRecordInvariant(
          current,
          "org unit",
        );

        if (current.status === "ARCHIVED") {
          throw new OrgUnitStateError(
            `Archived org unit cannot be moved: ${orgUnitId}`,
          );
        }

        if (
          current.parentOrgUnitId ===
          newParentOrgUnitId
        ) {
          controls.markExplicitNoOpSuccess();
          return toOrgUnitMutationView(current);
        }

        let newAncestorChain: readonly string[] = [];

        if (newParentOrgUnitId !== null) {
          const newParent =
            await this.requireOrgUnit(
              newParentOrgUnitId,
              session,
            );
          assertHierarchyRecordInvariant(
            newParent,
            "new parent org unit",
          );

          if (newParent.id === current.id) {
            throw new OrgUnitHierarchyCycleError(
              "Org unit cannot parent itself",
            );
          }

          assertParentActive(
            newParent,
            newParentOrgUnitId,
          );

          if (
            newParent.ancestorChain.includes(
              current.id,
            )
          ) {
            throw new OrgUnitHierarchyCycleError(
              "Org unit cannot be moved under one of its descendants",
            );
          }

          newAncestorChain = [
            ...newParent.ancestorChain,
            newParent.id,
          ];
        }

        const siblingConflict =
          await this.repository.findLiveSiblingByNormalizedName(
            {
              parentOrgUnitId:
                newParentOrgUnitId,
              normalizedName:
                current.normalizedName,
              excludeOrgUnitId: current.id,
            },
            session,
          );

        if (siblingConflict) {
          throw new OrgUnitConflictError(
            "A live sibling org unit already uses the same normalized name",
          );
        }

        const descendants =
          await this.repository.listDescendants(
            current.id,
            session,
          );
        descendants.forEach((descendant) =>
          assertHierarchyRecordInvariant(
            descendant,
            "descendant org unit",
          ),
        );

        const now = Date.now();
        const descendantsPatch =
          buildDescendantHierarchyPatch({
            current,
            newAncestorChain,
            descendants,
            updatedAt: now,
          });

        let moved: OrgUnitRecord | null;

        try {
          moved =
            await this.repository.rewriteHierarchy(
              {
                orgUnitId: current.id,
                parentOrgUnitId:
                  newParentOrgUnitId,
                ancestorChain:
                  newAncestorChain,
                depth:
                  newAncestorChain.length,
                updatedAt: now,
                descendants: descendantsPatch,
              },
              session,
            );
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            throw new OrgUnitConflictError(
              "A live sibling org unit already uses the same normalized name",
            );
          }

          throw error;
        }

        if (!moved) {
          throw new OrgUnitConflictError(
            `Failed to move org unit: ${orgUnitId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          orgUnitId,
          mutationType: operation,
          metadata: {
            changeApplied: true,
            previousParentOrgUnitId:
              current.parentOrgUnitId,
            requestedParentOrgUnitId:
              newParentOrgUnitId,
            descendantCount:
              descendantsPatch.length,
          },
          session,
        });

        return toOrgUnitMutationView(moved);
      },
      (result) => ({
        orgUnitId: result.id,
        parentOrgUnitId: result.parentOrgUnitId,
        status: result.status,
      }),
    );
  }

  async activateOrgUnit(
    actor: Actor,
    command: ActivateOrgUnitCommand,
  ): Promise<OrgUnitMutationResult> {
    const operation = "org-unit.activate";
    const permission = this.assertPermission(
      actor,
      Permission.ORG_UNIT_MANAGE_LIFECYCLE,
    );
    const orgUnitId = normalizeRequiredText(
      command.orgUnitId,
      "orgUnitId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        orgUnitId: readOptionalLogString(
          command.orgUnitId,
        ),
      },
      async (session) => {
        const current =
          await this.requireOrgUnit(
            orgUnitId,
            session,
          );
        assertHierarchyRecordInvariant(
          current,
          "org unit",
        );

        if (current.status !== "INACTIVE") {
          throw new OrgUnitStateError(
            `Org unit ${orgUnitId} cannot transition from ${current.status} to ACTIVE`,
          );
        }

        if (current.parentOrgUnitId) {
          const parent =
            await this.requireOrgUnit(
              current.parentOrgUnitId,
              session,
            );
          assertHierarchyRecordInvariant(
            parent,
            "parent org unit",
          );
          assertParentActive(
            parent,
            current.parentOrgUnitId,
          );
        }

        const updated =
          await this.repository.transitionStatus(
            {
              orgUnitId,
              fromStatuses: ["INACTIVE"],
              toStatus: "ACTIVE",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new OrgUnitConflictError(
            `Org unit state transition conflict for ${orgUnitId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          orgUnitId,
          mutationType: operation,
          metadata: {
            previousStatus:
              current.status,
            nextStatus: updated.status,
          },
          session,
        });

        return toOrgUnitMutationView(updated);
      },
      (result) => ({
        orgUnitId: result.id,
        status: result.status,
      }),
    );
  }

  async deactivateOrgUnit(
    actor: Actor,
    command: DeactivateOrgUnitCommand,
  ): Promise<OrgUnitMutationResult> {
    const operation = "org-unit.deactivate";
    const permission = this.assertPermission(
      actor,
      Permission.ORG_UNIT_MANAGE_LIFECYCLE,
    );
    const orgUnitId = normalizeRequiredText(
      command.orgUnitId,
      "orgUnitId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        orgUnitId: readOptionalLogString(
          command.orgUnitId,
        ),
      },
      async (session) => {
        const current =
          await this.requireOrgUnit(
            orgUnitId,
            session,
          );
        assertHierarchyRecordInvariant(
          current,
          "org unit",
        );

        if (current.status !== "ACTIVE") {
          throw new OrgUnitStateError(
            `Org unit ${orgUnitId} cannot transition from ${current.status} to INACTIVE`,
          );
        }

        const hasActiveDescendants =
          await this.repository.hasDescendantWithStatuses(
            orgUnitId,
            ["ACTIVE"],
            session,
          );

        if (hasActiveDescendants) {
          throw new OrgUnitStateError(
            `Cannot deactivate org unit ${orgUnitId} while active descendants exist`,
          );
        }

        const hasAssignedEmploymentProfiles =
          await this.employmentReadonlyAccess.hasNonArchivedProfilesAssignedToOrgUnit(
            orgUnitId,
            session,
          );

        if (hasAssignedEmploymentProfiles) {
          throw new OrgUnitStateError(
            `Cannot deactivate org unit ${orgUnitId} while non-archived employment profiles remain assigned`,
          );
        }

        await this.assertNoActiveOwnedPlatformAccounts(
          orgUnitId,
          session,
        );

        const updated =
          await this.repository.transitionStatus(
            {
              orgUnitId,
              fromStatuses: ["ACTIVE"],
              toStatus: "INACTIVE",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new OrgUnitConflictError(
            `Org unit state transition conflict for ${orgUnitId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          orgUnitId,
          mutationType: operation,
          metadata: {
            previousStatus:
              current.status,
            nextStatus: updated.status,
          },
          session,
        });

        return toOrgUnitMutationView(updated);
      },
      (result) => ({
        orgUnitId: result.id,
        status: result.status,
      }),
    );
  }

  async archiveOrgUnit(
    actor: Actor,
    command: ArchiveOrgUnitCommand,
  ): Promise<OrgUnitMutationResult> {
    const operation = "org-unit.archive";
    const permission = this.assertPermission(
      actor,
      Permission.ORG_UNIT_MANAGE_LIFECYCLE,
    );
    const orgUnitId = normalizeRequiredText(
      command.orgUnitId,
      "orgUnitId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        orgUnitId: readOptionalLogString(
          command.orgUnitId,
        ),
      },
      async (session) => {
        const current =
          await this.requireOrgUnit(
            orgUnitId,
            session,
          );
        assertHierarchyRecordInvariant(
          current,
          "org unit",
        );

        if (
          current.status !== "ACTIVE" &&
          current.status !== "INACTIVE"
        ) {
          throw new OrgUnitStateError(
            `Org unit ${orgUnitId} cannot transition from ${current.status} to ARCHIVED`,
          );
        }

        const hasNonArchivedDescendants =
          await this.repository.hasNonArchivedDescendants(
            orgUnitId,
            session,
          );

        if (hasNonArchivedDescendants) {
          throw new OrgUnitStateError(
            `Cannot archive org unit ${orgUnitId} while non-archived descendants exist`,
          );
        }

        const hasAssignedEmploymentProfiles =
          await this.employmentReadonlyAccess.hasNonArchivedProfilesAssignedToOrgUnit(
            orgUnitId,
            session,
          );

        if (hasAssignedEmploymentProfiles) {
          throw new OrgUnitStateError(
            `Cannot archive org unit ${orgUnitId} while non-archived employment profiles remain assigned`,
          );
        }

        await this.assertNoNonArchivedOwnedPlatformAccounts(
          orgUnitId,
          session,
        );

        const updated =
          await this.repository.transitionStatus(
            {
              orgUnitId,
              fromStatuses: [
                "ACTIVE",
                "INACTIVE",
              ],
              toStatus: "ARCHIVED",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new OrgUnitConflictError(
            `Org unit state transition conflict for ${orgUnitId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          orgUnitId,
          mutationType: operation,
          metadata: {
            previousStatus:
              current.status,
            nextStatus: updated.status,
          },
          session,
        });

        return toOrgUnitMutationView(updated);
      },
      (result) => ({
        orgUnitId: result.id,
        status: result.status,
      }),
    );
  }

  private assertPermission(
    actor: Actor,
    permissionCode: Permission,
  ): PermissionContract {
    const permission =
      PermissionResolver.resolve(permissionCode);

    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);
    return permission;
  }

  private async requireOrgUnit(
    orgUnitId: string,
    session: ClientSession,
  ): Promise<OrgUnitRecord> {
    const orgUnit =
      await this.repository.findById(
        orgUnitId,
        session,
      );

    if (!orgUnit) {
      throw new OrgUnitNotFoundError(orgUnitId);
    }

    return orgUnit;
  }

  private async assertNoActiveOwnedPlatformAccounts(
    orgUnitId: string,
    session: ClientSession,
  ): Promise<void> {
    const hasActiveOwnedPlatformAccounts =
      await this.platformAccountReadonlyAccess.hasActiveOwnedPlatformAccountsForOrgUnit(
        orgUnitId,
        session,
      );

    if (hasActiveOwnedPlatformAccounts) {
      throw new OrgUnitStateError(
        `Cannot deactivate org unit ${orgUnitId} while ACTIVE platform accounts remain owned`,
      );
    }
  }

  private async assertNoNonArchivedOwnedPlatformAccounts(
    orgUnitId: string,
    session: ClientSession,
  ): Promise<void> {
    const hasNonArchivedOwnedPlatformAccounts =
      await this.platformAccountReadonlyAccess.hasNonArchivedOwnedPlatformAccountsForOrgUnit(
        orgUnitId,
        session,
      );

    if (hasNonArchivedOwnedPlatformAccounts) {
      throw new OrgUnitStateError(
        `Cannot archive org unit ${orgUnitId} while non-archived platform accounts remain owned`,
      );
    }
  }

  private async recordAudit(params: {
    readonly actor: Actor;
    readonly permission: PermissionContract;
    readonly orgUnitId: string;
    readonly mutationType: AuthoritativeAdminMutationIdentity;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly session: ClientSession;
  }): Promise<void> {
    await this.audit.record(
      params.actor,
      params.permission,
      params.orgUnitId,
      {
        mutationType: params.mutationType,
        targetId: params.orgUnitId,
        targetType: "orgUnit",
        actorId: params.actor.id,
        ...params.metadata,
      },
      params.session,
    );
  }

  private async executeMutation<T>(
    actor: Actor,
    permission: PermissionContract,
    operation: AuthoritativeAdminMutationIdentity,
    startMetadata: Readonly<Record<string, unknown>>,
    fn: (
      session: ClientSession,
      controls: AuthoritativeMutationControls,
    ) => Promise<T>,
    onSuccess: (result: T) => Readonly<Record<string, unknown>>,
  ): Promise<T> {
    this.logMutationEvent(
      actor,
      operation,
      "mutation.start",
      startMetadata,
    );

    try {
      const traceId = getTraceIdOrThrow();

      const result = await this.mutationBridge.execute(
        {
          actor,
          traceId,
          requiredPermission: permission,
          mutationIdentity: operation,
          mutationTargetDescriptor:
            buildMutationTargetDescriptor(
              startMetadata,
            ),
        },
        async (session, controls) =>
          fn(session, controls),
      );

      this.logMutationEvent(
        actor,
        operation,
        "mutation.success",
        {
          ...startMetadata,
          ...onSuccess(result),
        },
      );

      return result;
    } catch (error) {
      this.logger.warn({
        traceId: getTraceIdOrThrow(),
        actorId: actor.id,
        context: actor.context,
        operation,
        status: "mutation.failed",
        timestamp: Date.now(),
        metadata: {
          ...startMetadata,
          classification:
            classifyOrgUnitMutationFailure(
              error,
            ),
          errorCode: extractErrorCode(error),
          errorMessage:
            truncateLogMessage(error),
        },
      });

      throw error;
    }
  }

  private logMutationEvent(
    actor: Actor,
    operation: AuthoritativeAdminMutationIdentity,
    status: "mutation.start" | "mutation.success",
    metadata: Readonly<Record<string, unknown>>,
  ): void {
    this.logger.info({
      traceId: getTraceIdOrThrow(),
      actorId: actor.id,
      context: actor.context,
      operation,
      status,
      timestamp: Date.now(),
      metadata,
    });
  }
}

interface NormalizedCreateCommand {
  readonly code: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly type: OrgUnitType;
  readonly parentOrgUnitId: string | null;
  readonly description: string | null;
  readonly displayOrder: number;
  readonly externalRef: string | null;
}

function normalizeCreateCommand(
  command: CreateOrgUnitCommand,
): NormalizedCreateCommand {
  const code = normalizeRequiredText(
    command.code,
    "code",
  );
  const name = normalizeRequiredText(
    command.name,
    "name",
  );

  return {
    code,
    name,
    normalizedName: normalizeOrgUnitName(name),
    type: normalizeOrgUnitType(command.type),
    parentOrgUnitId:
      normalizeOptionalNullableId(
        command.parentOrgUnitId,
      ),
    description: normalizeNullableText(
      command.description,
      "description",
    ),
    displayOrder: normalizeInteger(
      command.displayOrder,
      "displayOrder",
    ),
    externalRef: normalizeNullableText(
      command.externalRef,
      "externalRef",
    ),
  };
}

function buildMutationTargetDescriptor(
  metadata: Readonly<Record<string, unknown>>,
): string {
  const encoded = JSON.stringify(metadata);

  if (
    typeof encoded === "string" &&
    encoded.length > 2
  ) {
    return encoded;
  }

  return "target:unspecified";
}

function buildOrgUnitProfilePatch(params: {
  readonly current: OrgUnitRecord;
  readonly orgUnitId: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly displayOrder?: number;
  readonly externalRef?: string | null;
}): UpdateOrgUnitProfileInput {
  const patch: {
    orgUnitId: string;
    updatedAt: number;
    name?: string;
    normalizedName?: string;
    description?: string | null;
    displayOrder?: number;
    externalRef?: string | null;
  } = {
    orgUnitId: params.orgUnitId,
    updatedAt: Date.now(),
  };

  if (
    params.name !== undefined &&
    params.name !== params.current.name
  ) {
    patch.name = params.name;
    patch.normalizedName =
      normalizeOrgUnitName(params.name);
  }

  if (
    params.description !== undefined &&
    params.description !==
      params.current.description
  ) {
    patch.description = params.description;
  }

  if (
    params.displayOrder !== undefined &&
    params.displayOrder !==
      params.current.displayOrder
  ) {
    patch.displayOrder = params.displayOrder;
  }

  if (
    params.externalRef !== undefined &&
    params.externalRef !==
      params.current.externalRef
  ) {
    patch.externalRef = params.externalRef;
  }

  return patch;
}

function buildDescendantHierarchyPatch(params: {
  readonly current: OrgUnitRecord;
  readonly newAncestorChain: readonly string[];
  readonly descendants: readonly OrgUnitRecord[];
  readonly updatedAt: number;
}): readonly RewriteOrgUnitHierarchyDescendantInput[] {
  const currentPrefixLength =
    params.current.ancestorChain.length + 1;

  return params.descendants.map((descendant) => {
    const ancestorPrefix =
      descendant.ancestorChain.slice(
        0,
        currentPrefixLength,
      );
    const expectedPrefix = [
      ...params.current.ancestorChain,
      params.current.id,
    ];

    if (
      ancestorPrefix.length !==
        expectedPrefix.length ||
      ancestorPrefix.some(
        (value, index) =>
          value !== expectedPrefix[index],
      )
    ) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        `Descendant ${descendant.id} has invalid ancestor chain prefix for move rewrite`,
      );
    }

    const suffix =
      descendant.ancestorChain.slice(
        currentPrefixLength,
      );
    const nextAncestorChain = [
      ...params.newAncestorChain,
      params.current.id,
      ...suffix,
    ];

    return {
      orgUnitId: descendant.id,
      ancestorChain: nextAncestorChain,
      depth: nextAncestorChain.length,
      updatedAt: params.updatedAt,
    };
  });
}

function assertParentActive(
  parent: OrgUnitRecord,
  parentOrgUnitId: string,
): void {
  if (parent.status === "ACTIVE") {
    return;
  }

  throw new OrgUnitParentStateError(
    `Parent org unit must be ACTIVE: ${parentOrgUnitId}`,
  );
}

function assertHierarchyRecordInvariant(
  orgUnit: OrgUnitRecord,
  label: string,
): void {
  if (orgUnit.depth !== orgUnit.ancestorChain.length) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `${label} depth does not match ancestorChain length: ${orgUnit.id}`,
    );
  }

  if (orgUnit.ancestorChain.includes(orgUnit.id)) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `${label} ancestorChain must not contain self: ${orgUnit.id}`,
    );
  }

  if (orgUnit.parentOrgUnitId === null) {
    if (orgUnit.ancestorChain.length !== 0) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        `${label} root record must have empty ancestorChain: ${orgUnit.id}`,
      );
    }

    if (orgUnit.depth !== 0) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        `${label} root record must have depth=0: ${orgUnit.id}`,
      );
    }

    return;
  }

  if (orgUnit.ancestorChain.length === 0) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `${label} non-root record must have non-empty ancestorChain: ${orgUnit.id}`,
    );
  }

  const immediateParent =
    orgUnit.ancestorChain[
      orgUnit.ancestorChain.length - 1
    ];

  if (immediateParent !== orgUnit.parentOrgUnitId) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `${label} immediate parent mismatch in ancestorChain: ${orgUnit.id}`,
    );
  }
}

function toOrgUnitMutationView(
  orgUnit: OrgUnitRecord,
): OrgUnitMutationView {
  return {
    id: orgUnit.id,
    code: orgUnit.code,
    name: orgUnit.name,
    type: orgUnit.type,
    status: orgUnit.status,
    description: orgUnit.description,
    externalRef: orgUnit.externalRef,
    parentOrgUnitId: orgUnit.parentOrgUnitId,
    depth: orgUnit.depth,
    displayOrder: orgUnit.displayOrder,
    createdAt: orgUnit.createdAt,
    updatedAt: orgUnit.updatedAt,
    hierarchy: {
      id: orgUnit.id,
      parentOrgUnitId: orgUnit.parentOrgUnitId,
      depth: orgUnit.depth,
      ancestorChain: [...orgUnit.ancestorChain],
    },
  };
}

function normalizeRequiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new OrgUnitValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new OrgUnitValidationError(
      `${field} is required`,
    );
  }

  return normalized;
}

function normalizeNullableText(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new OrgUnitValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new OrgUnitValidationError(
      `${field} must not be empty`,
    );
  }

  return normalized;
}

function normalizeNullablePatchText(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined) {
    throw new OrgUnitValidationError(
      `${field} must be provided`,
    );
  }

  return normalizeNullableText(value, field);
}

function normalizeOptionalNullableId(
  value: unknown,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new OrgUnitValidationError(
      "parentOrgUnitId must be a string",
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new OrgUnitValidationError(
      "parentOrgUnitId must not be empty",
    );
  }

  return normalized;
}

function normalizeRequiredNullableId(
  value: unknown,
  field: string,
): string | null {
  if (value === null) {
    return null;
  }

  if (value === undefined) {
    throw new OrgUnitValidationError(
      `${field} must be provided`,
    );
  }

  if (typeof value !== "string") {
    throw new OrgUnitValidationError(
      `${field} must be a string or null`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new OrgUnitValidationError(
      `${field} must not be empty`,
    );
  }

  return normalized;
}

function normalizeInteger(
  value: unknown,
  field: string,
): number {
  let numeric: number;

  if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "string") {
    if (!value.trim()) {
      throw new OrgUnitValidationError(
        `${field} must be an integer`,
      );
    }

    numeric = Number(value);
  } else {
    throw new OrgUnitValidationError(
      `${field} must be an integer`,
    );
  }

  if (
    !Number.isInteger(numeric) ||
    !Number.isSafeInteger(numeric)
  ) {
    throw new OrgUnitValidationError(
      `${field} must be an integer`,
    );
  }

  return numeric;
}

function normalizeOrgUnitType(
  value: unknown,
): OrgUnitType {
  if (typeof value === "string") {
    const normalized = value.trim();

    if (
      ORG_UNIT_TYPES.includes(
        normalized as OrgUnitType,
      )
    ) {
      return normalized as OrgUnitType;
    }
  }

  throw new OrgUnitValidationError(
    `type must be one of ${ORG_UNIT_TYPES.join(", ")}`,
  );
}

function normalizeOrgUnitName(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function normalizeSearchCode(
  value: string,
): string {
  return value.trim().toLowerCase();
}

function isDuplicateKeyError(
  error: unknown,
): error is MongoServerError {
  return (
    error instanceof MongoServerError &&
    error.code === 11000
  );
}

function classifyOrgUnitMutationFailure(
  error: unknown,
): OrgUnitFailureClassification {
  if (error instanceof OrgUnitValidationError) {
    return "validation";
  }

  if (error instanceof OrgUnitConflictError) {
    return "conflict";
  }

  if (error instanceof OrgUnitNotFoundError) {
    return "not_found";
  }

  if (error instanceof OrgUnitStateError) {
    return "state_error";
  }

  if (error instanceof OrgUnitParentStateError) {
    return "parent_state";
  }

  if (error instanceof OrgUnitHierarchyCycleError) {
    return "hierarchy_cycle";
  }

  if (error instanceof SystemInvariantError) {
    return "invariant";
  }

  return "unknown";
}

function extractErrorCode(
  error: unknown,
): string | undefined {
  if (error instanceof BaseAppError) {
    return error.code;
  }

  if (error instanceof SystemInvariantError) {
    return error.code;
  }

  return undefined;
}

function truncateLogMessage(
  error: unknown,
): string {
  const raw =
    error instanceof Error
      ? error.message
      : String(error);

  if (raw.length <= 256) {
    return raw;
  }

  return `${raw.slice(0, 253)}...`;
}

function readOptionalLogString(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0
    ? normalized
    : undefined;
}
