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
  StudioResourceConflictError,
  StudioResourceInvalidOperationalStatusError,
  StudioResourceInvalidResourceShapeError,
  StudioResourceNotFoundError,
  StudioResourceStateError,
  StudioResourceValidationError,
} from "@modules/studio-resource/domain/studio-resource.errors";
import {
  StudioResourceRepository,
  TransitionStudioResourceOperationalStatusInput,
  UpdateStudioResourceCoreInput,
} from "@modules/studio-resource/domain/studio-resource.repository";
import { StudioResourceEventAssignmentReadonlyAccess } from "@modules/studio-resource/domain/studio-resource-event-assignment-readonly-access";
import { StudioResourceWorkScheduleReadonlyAccess } from "@modules/studio-resource/domain/studio-resource-work-schedule-readonly-access";
import {
  STUDIO_RESOURCE_CLASSES,
  StudioResourceClass,
  StudioResourceMutationView,
  StudioResourceOperationalStatus,
  StudioResourceRecord,
} from "@modules/studio-resource/domain/studio-resource.types";
import {
  ActivateStudioResourceCommand,
  ArchiveStudioResourceCommand,
  CreateStudioResourceCommand,
  DeactivateStudioResourceCommand,
  MarkStudioResourceOutOfServiceCommand,
  RestoreStudioResourceToActiveCommand,
  StudioResourceMutationResult,
  UpdateStudioResourceCoreCommand,
} from "@modules/studio-resource/shared/studio-resource.contracts";

type StudioResourceFailureClassification =
  | "validation"
  | "conflict"
  | "not_found"
  | "state_error"
  | "invalid_resource_shape"
  | "invalid_operational_status"
  | "invariant"
  | "unknown";

interface NormalizedCreateCommand {
  readonly resourceCode: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly shortName: string | null;
  readonly normalizedShortName: string | null;
  readonly resourceClass: StudioResourceClass;
  readonly locationLabel: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly maxOccupancy: number | null;
}

interface NormalizedUpdateCoreCommand {
  readonly studioResourceId: string;
  readonly name?: string;
  readonly shortName?: string | null;
  readonly locationLabel?: string | null;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly maxOccupancy?: number | null;
}

export class StudioResourceAdminService {
  constructor(
    private readonly repository: StudioResourceRepository,
    private readonly workScheduleReadonlyAccess: StudioResourceWorkScheduleReadonlyAccess,
    private readonly eventAssignmentReadonlyAccess: StudioResourceEventAssignmentReadonlyAccess,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly logger: StructuredLogger = createStructuredLogger(),
  ) {}

  async createStudioResource(
    actor: Actor,
    command: CreateStudioResourceCommand,
  ): Promise<StudioResourceMutationResult> {
    const operation = "studio-resource.create";
    const permission = this.assertPermission(
      actor,
      Permission.STUDIO_RESOURCE_CREATE,
    );
    const input = normalizeCreateCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        resourceCode: input.resourceCode,
        resourceClass: input.resourceClass,
      },
      async (session) => {
        const existing =
          await this.repository.findByResourceCode(
            input.resourceCode,
            session,
          );

        if (existing) {
          throw new StudioResourceConflictError(
            `Studio resource code already exists: ${input.resourceCode}`,
          );
        }

        assertResourceShape(
          input.resourceClass,
          input.maxOccupancy,
        );

        const now = Date.now();
        const record: StudioResourceRecord = {
          id: crypto.randomUUID(),
          resourceCode: input.resourceCode,
          name: input.name,
          normalizedName: input.normalizedName,
          shortName: input.shortName,
          normalizedShortName:
            input.normalizedShortName,
          resourceClass: input.resourceClass,
          operationalStatus: "ACTIVE",
          locationLabel: input.locationLabel,
          description: input.description,
          externalRef: input.externalRef,
          maxOccupancy: input.maxOccupancy,
          createdAt: now,
          updatedAt: now,
        };

        let created: StudioResourceRecord;

        try {
          created = await this.repository.insert(
            record,
            session,
          );
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            throw new StudioResourceConflictError(
              "Studio resource code conflict detected on create",
            );
          }

          throw error;
        }

        await this.recordAudit({
          actor,
          permission,
          studioResourceId: created.id,
          mutationType: operation,
          metadata: {
            resourceCode: created.resourceCode,
            resourceClass: created.resourceClass,
            operationalStatus:
              created.operationalStatus,
            maxOccupancy: created.maxOccupancy,
          },
          session,
        });

        return toMutationView(created);
      },
      (result) => ({
        studioResourceId: result.id,
        operationalStatus: result.operationalStatus,
      }),
    );
  }

  async updateStudioResourceCore(
    actor: Actor,
    command: UpdateStudioResourceCoreCommand,
  ): Promise<StudioResourceMutationResult> {
    const operation = "studio-resource.update-core";
    const permission = this.assertPermission(
      actor,
      Permission.STUDIO_RESOURCE_UPDATE,
    );
    const input = normalizeUpdateCoreCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        studioResourceId: input.studioResourceId,
      },
      async (session) => {
        const current = await this.requireStudioResource(
          input.studioResourceId,
          session,
        );

        if (
          current.operationalStatus === "ARCHIVED"
        ) {
          throw new StudioResourceStateError(
            `Archived studio resource cannot be updated: ${current.id}`,
          );
        }

        assertResourceShape(
          current.resourceClass,
          current.maxOccupancy,
        );

        const patch = buildStudioResourceCorePatch({
          current,
          ...input,
        });
        const changedFields =
          summarizeChangedCoreFields(patch);

        if (changedFields.length === 0) {
          throw new StudioResourceValidationError(
            "At least one changed field is required",
          );
        }

        assertResourceShape(
          current.resourceClass,
          patch.maxOccupancy !== undefined
            ? patch.maxOccupancy
            : current.maxOccupancy,
        );

        const updated = await this.repository.updateCore(
          patch,
          session,
        );

        if (!updated) {
          throw new StudioResourceConflictError(
            `Failed to update studio resource: ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          studioResourceId: updated.id,
          mutationType: operation,
          metadata: {
            changedFields,
            operationalStatus:
              updated.operationalStatus,
          },
          session,
        });

        return toMutationView(updated);
      },
      (result) => ({
        studioResourceId: result.id,
        operationalStatus: result.operationalStatus,
      }),
    );
  }

  async markStudioResourceOutOfService(
    actor: Actor,
    command: MarkStudioResourceOutOfServiceCommand,
  ): Promise<StudioResourceMutationResult> {
    return this.transitionStudioResourceStatus(
      actor,
      Permission.STUDIO_RESOURCE_MANAGE_AVAILABILITY,
      "studio-resource.mark-out-of-service",
      command.studioResourceId,
      ["ACTIVE"],
      "OUT_OF_SERVICE",
      async (current, session) => {
        await this.assertNoLiveDownstreamAllocations(
          current.id,
          "mark out of service",
          Date.now(),
          session,
        );
      },
    );
  }

  async restoreStudioResourceToActive(
    actor: Actor,
    command: RestoreStudioResourceToActiveCommand,
  ): Promise<StudioResourceMutationResult> {
    return this.transitionStudioResourceStatus(
      actor,
      Permission.STUDIO_RESOURCE_MANAGE_AVAILABILITY,
      "studio-resource.restore-to-active",
      command.studioResourceId,
      ["OUT_OF_SERVICE"],
      "ACTIVE",
    );
  }

  async deactivateStudioResource(
    actor: Actor,
    command: DeactivateStudioResourceCommand,
  ): Promise<StudioResourceMutationResult> {
    return this.transitionStudioResourceStatus(
      actor,
      Permission.STUDIO_RESOURCE_MANAGE_LIFECYCLE,
      "studio-resource.deactivate",
      command.studioResourceId,
      ["ACTIVE", "OUT_OF_SERVICE"],
      "INACTIVE",
      async (current, session) => {
        await this.assertNoLiveDownstreamAllocations(
          current.id,
          "deactivate",
          Date.now(),
          session,
        );
      },
    );
  }

  async activateStudioResource(
    actor: Actor,
    command: ActivateStudioResourceCommand,
  ): Promise<StudioResourceMutationResult> {
    return this.transitionStudioResourceStatus(
      actor,
      Permission.STUDIO_RESOURCE_MANAGE_LIFECYCLE,
      "studio-resource.activate",
      command.studioResourceId,
      ["INACTIVE"],
      "ACTIVE",
    );
  }

  async archiveStudioResource(
    actor: Actor,
    command: ArchiveStudioResourceCommand,
  ): Promise<StudioResourceMutationResult> {
    return this.transitionStudioResourceStatus(
      actor,
      Permission.STUDIO_RESOURCE_MANAGE_LIFECYCLE,
      "studio-resource.archive",
      command.studioResourceId,
      ["INACTIVE"],
      "ARCHIVED",
      async (current, session) => {
        await this.assertNoLiveDownstreamAllocations(
          current.id,
          "archive",
          Date.now(),
          session,
        );
      },
    );
  }

  private async transitionStudioResourceStatus(
    actor: Actor,
    permissionCode: Permission,
    operation: AuthoritativeAdminMutationIdentity,
    studioResourceIdInput: string,
    fromStatuses: readonly StudioResourceOperationalStatus[],
    toStatus: StudioResourceOperationalStatus,
    precondition?: (
      current: StudioResourceRecord,
      session: ClientSession,
    ) => Promise<void>,
  ): Promise<StudioResourceMutationResult> {
    const permission = this.assertPermission(
      actor,
      permissionCode,
    );
    const studioResourceId = normalizeRequiredText(
      studioResourceIdInput,
      "studioResourceId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        studioResourceId,
        targetStatus: toStatus,
      },
      async (session) => {
        const current = await this.requireStudioResource(
          studioResourceId,
          session,
        );

        assertResourceShape(
          current.resourceClass,
          current.maxOccupancy,
        );
        assertExpectedOperationalStatus(
          current.operationalStatus,
          fromStatuses,
          operation,
        );

        if (precondition) {
          await precondition(current, session);
        }

        const transition: TransitionStudioResourceOperationalStatusInput = {
          studioResourceId,
          fromStatuses,
          toStatus,
          updatedAt: Date.now(),
        };
        const updated =
          await this.repository.transitionOperationalStatus(
            transition,
            session,
          );

        if (!updated) {
          throw new StudioResourceConflictError(
            `Failed to transition studio resource status: ${studioResourceId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          studioResourceId: updated.id,
          mutationType: operation,
          metadata: {
            beforeStatus: current.operationalStatus,
            afterStatus: updated.operationalStatus,
          },
          session,
        });

        return toMutationView(updated);
      },
      (result) => ({
        studioResourceId: result.id,
        operationalStatus: result.operationalStatus,
      }),
    );
  }

  private assertPermission(
    actor: Actor,
    permissionCode: Permission,
  ): PermissionContract {
    assertAdminActorType(actor);

    const permission =
      PermissionResolver.resolve(permissionCode);

    PermissionGuard.assert(actor, permission);
    return permission;
  }

  private async requireStudioResource(
    studioResourceId: string,
    session: ClientSession,
  ): Promise<StudioResourceRecord> {
    const studioResource = await this.repository.findById(
      studioResourceId,
      session,
    );

    if (!studioResource) {
      throw new StudioResourceNotFoundError(
        studioResourceId,
      );
    }

    return studioResource;
  }

  private async assertNoLiveDownstreamAllocations(
    studioResourceId: string,
    operation:
      | "mark out of service"
      | "deactivate"
      | "archive",
    evaluationTime: number,
    session: ClientSession,
  ): Promise<void> {
    const hasLiveScheduledWorkShift =
      await this.workScheduleReadonlyAccess.hasLiveScheduledShiftForStudioResource(
        studioResourceId,
        evaluationTime,
        session,
      );

    if (hasLiveScheduledWorkShift) {
      throw new StudioResourceStateError(
        `Cannot ${operation} studio resource ${studioResourceId} while live scheduled work shifts exist`,
      );
    }

    const hasLiveEventAllocation =
      await this.eventAssignmentReadonlyAccess.hasLiveEventAllocationForStudioResource(
        studioResourceId,
        evaluationTime,
        session,
      );

    if (!hasLiveEventAllocation) {
      return;
    }

    throw new StudioResourceStateError(
      `Cannot ${operation} studio resource ${studioResourceId} while live event allocations exist`,
    );
  }

  private async recordAudit(params: {
    readonly actor: Actor;
    readonly permission: PermissionContract;
    readonly studioResourceId: string;
    readonly mutationType: AuthoritativeAdminMutationIdentity;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly session: ClientSession;
  }): Promise<void> {
    await this.audit.record(
      params.actor,
      params.permission,
      params.studioResourceId,
      {
        mutationType: params.mutationType,
        targetId: params.studioResourceId,
        targetType: "studio-resource",
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
            classifyStudioResourceMutationFailure(
              error,
            ),
          errorCode: extractErrorCode(error),
          errorMessage: truncateLogMessage(error),
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

function normalizeCreateCommand(
  command: CreateStudioResourceCommand,
): NormalizedCreateCommand {
  const name = normalizeRequiredText(
    command.name,
    "name",
  );
  const shortNameInput = normalizeOptionalNullableText(
    command.shortName,
    "shortName",
  );
  const shortName = shortNameInput ?? null;

  return {
    resourceCode: normalizeRequiredText(
      command.resourceCode,
      "resourceCode",
    ),
    name,
    normalizedName: normalizeNameForSearch(name),
    shortName,
    normalizedShortName:
      shortName === null
        ? null
        : normalizeNameForSearch(shortName),
    resourceClass: normalizeResourceClass(
      command.resourceClass,
    ),
    locationLabel:
      normalizeOptionalNullableText(
        command.locationLabel,
        "locationLabel",
      ) ?? null,
    description:
      normalizeOptionalNullableText(
        command.description,
        "description",
      ) ?? null,
    externalRef:
      normalizeOptionalNullableText(
        command.externalRef,
        "externalRef",
      ) ?? null,
    maxOccupancy:
      normalizeOptionalMaxOccupancy(
        command.maxOccupancy,
        "maxOccupancy",
      ) ?? null,
  };
}

function normalizeUpdateCoreCommand(
  command: UpdateStudioResourceCoreCommand,
): NormalizedUpdateCoreCommand {
  return {
    studioResourceId: normalizeRequiredText(
      command.studioResourceId,
      "studioResourceId",
    ),
    name: normalizeOptionalNonNullableText(
      command.name,
      "name",
    ),
    shortName: normalizeOptionalNullableText(
      command.shortName,
      "shortName",
    ),
    locationLabel: normalizeOptionalNullableText(
      command.locationLabel,
      "locationLabel",
    ),
    description: normalizeOptionalNullableText(
      command.description,
      "description",
    ),
    externalRef: normalizeOptionalNullableText(
      command.externalRef,
      "externalRef",
    ),
    maxOccupancy: normalizeOptionalMaxOccupancy(
      command.maxOccupancy,
      "maxOccupancy",
    ),
  };
}

function buildStudioResourceCorePatch(params: {
  readonly current: StudioResourceRecord;
  readonly studioResourceId: string;
  readonly name?: string;
  readonly shortName?: string | null;
  readonly locationLabel?: string | null;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly maxOccupancy?: number | null;
}): UpdateStudioResourceCoreInput {
  const patch: {
    studioResourceId: string;
    updatedAt: number;
    name?: string;
    normalizedName?: string;
    shortName?: string | null;
    normalizedShortName?: string | null;
    locationLabel?: string | null;
    description?: string | null;
    externalRef?: string | null;
    maxOccupancy?: number | null;
  } = {
    studioResourceId: params.studioResourceId,
    updatedAt: Date.now(),
  };

  if (
    params.name !== undefined &&
    params.name !== params.current.name
  ) {
    patch.name = params.name;
    patch.normalizedName = normalizeNameForSearch(
      params.name,
    );
  }

  if (
    params.shortName !== undefined &&
    params.shortName !== params.current.shortName
  ) {
    patch.shortName = params.shortName;
    patch.normalizedShortName =
      params.shortName === null
        ? null
        : normalizeNameForSearch(params.shortName);
  }

  if (
    params.locationLabel !== undefined &&
    params.locationLabel !== params.current.locationLabel
  ) {
    patch.locationLabel = params.locationLabel;
  }

  if (
    params.description !== undefined &&
    params.description !== params.current.description
  ) {
    patch.description = params.description;
  }

  if (
    params.externalRef !== undefined &&
    params.externalRef !== params.current.externalRef
  ) {
    patch.externalRef = params.externalRef;
  }

  if (
    params.maxOccupancy !== undefined &&
    params.maxOccupancy !== params.current.maxOccupancy
  ) {
    patch.maxOccupancy = params.maxOccupancy;
  }

  return patch;
}

function summarizeChangedCoreFields(
  patch: UpdateStudioResourceCoreInput,
): readonly string[] {
  const changedFields: string[] = [];

  if (patch.name !== undefined) {
    changedFields.push("name");
  }

  if (patch.shortName !== undefined) {
    changedFields.push("shortName");
  }

  if (patch.locationLabel !== undefined) {
    changedFields.push("locationLabel");
  }

  if (patch.description !== undefined) {
    changedFields.push("description");
  }

  if (patch.externalRef !== undefined) {
    changedFields.push("externalRef");
  }

  if (patch.maxOccupancy !== undefined) {
    changedFields.push("maxOccupancy");
  }

  return changedFields;
}

function normalizeRequiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new StudioResourceValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new StudioResourceValidationError(
      `${field} is required`,
    );
  }

  return normalized;
}

function normalizeOptionalNonNullableText(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    throw new StudioResourceValidationError(
      `${field} must not be null`,
    );
  }

  return normalizeRequiredText(value, field);
}

function normalizeOptionalNullableText(
  value: unknown,
  field: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return normalizeRequiredText(value, field);
}

function normalizeOptionalMaxOccupancy(
  value: unknown,
  field: string,
): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new StudioResourceValidationError(
      `${field} must be a positive integer when provided`,
    );
  }

  return value;
}

function normalizeResourceClass(
  value: unknown,
): StudioResourceClass {
  if (typeof value !== "string") {
    throw new StudioResourceValidationError(
      `resourceClass must be one of ${STUDIO_RESOURCE_CLASSES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    STUDIO_RESOURCE_CLASSES.includes(
      normalized as StudioResourceClass,
    )
  ) {
    return normalized as StudioResourceClass;
  }

  throw new StudioResourceValidationError(
    `resourceClass must be one of ${STUDIO_RESOURCE_CLASSES.join(", ")}`,
  );
}

function normalizeNameForSearch(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function assertResourceShape(
  resourceClass: StudioResourceClass,
  maxOccupancy: number | null,
): void {
  if (resourceClass === "SPACE") {
    if (
      maxOccupancy === null ||
      maxOccupancy === undefined
    ) {
      return;
    }

    if (
      Number.isInteger(maxOccupancy) &&
      maxOccupancy > 0
    ) {
      return;
    }

    throw new StudioResourceInvalidResourceShapeError(
      "SPACE resources must have null or positive integer maxOccupancy",
    );
  }

  if (maxOccupancy !== null) {
    throw new StudioResourceInvalidResourceShapeError(
      "Only SPACE resources may store maxOccupancy",
    );
  }
}

function assertExpectedOperationalStatus(
  actual: StudioResourceOperationalStatus,
  expected: readonly StudioResourceOperationalStatus[],
  operation: string,
): void {
  if (expected.includes(actual)) {
    return;
  }

  throw new StudioResourceStateError(
    `${operation} requires operationalStatus in [${expected.join(", ")}], received ${actual}`,
  );
}

function assertAdminActorType(
  actor: Actor,
): void {
  if (actor.type === "admin") {
    return;
  }

  throw new SystemInvariantError(
    "PERMISSION_DENIED",
    `Studio resource access requires actor.type admin, received ${actor.type}`,
  );
}

function toMutationView(
  record: StudioResourceRecord,
): StudioResourceMutationView {
  return {
    id: record.id,
    resourceCode: record.resourceCode,
    name: record.name,
    shortName: record.shortName,
    resourceClass: record.resourceClass,
    operationalStatus: record.operationalStatus,
    locationLabel: record.locationLabel,
    description: record.description,
    externalRef: record.externalRef,
    maxOccupancy: record.maxOccupancy,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function isDuplicateKeyError(
  error: unknown,
): error is MongoServerError {
  return (
    error instanceof MongoServerError &&
    error.code === 11000
  );
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

function classifyStudioResourceMutationFailure(
  error: unknown,
): StudioResourceFailureClassification {
  if (error instanceof StudioResourceValidationError) {
    return "validation";
  }

  if (error instanceof StudioResourceConflictError) {
    return "conflict";
  }

  if (error instanceof StudioResourceNotFoundError) {
    return "not_found";
  }

  if (error instanceof StudioResourceStateError) {
    return "state_error";
  }

  if (
    error instanceof StudioResourceInvalidResourceShapeError
  ) {
    return "invalid_resource_shape";
  }

  if (
    error instanceof
    StudioResourceInvalidOperationalStatusError
  ) {
    return "invalid_operational_status";
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
