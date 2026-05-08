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
  WorkScheduleConflictError,
  WorkScheduleNotFoundError,
  WorkScheduleStateError,
  WorkScheduleValidationError,
} from "@modules/work-schedule/domain/work-schedule.errors";
import { WorkScheduleCodeSequenceRepository } from "@modules/work-schedule/domain/work-schedule-code-sequence.repository";
import {
  UpdateWorkPatternInput,
  WorkPatternRepository,
} from "@modules/work-schedule/domain/work-schedule.repository";
import {
  WORK_PATTERN_STATUSES,
  WORK_PATTERN_TIMEZONE,
  WORK_PATTERN_WEEKDAY_TOKENS,
  WorkPatternMutationView,
  WorkPatternRecord,
  WorkPatternWeekdayToken,
} from "@modules/work-schedule/domain/work-schedule.types";
import {
  CreateWorkPatternCommand,
  UpdateWorkPatternCommand,
  WorkPatternLifecycleCommand,
  WorkPatternMutationResult,
} from "@modules/work-schedule/shared/work-schedule.contracts";

const DEFAULT_WORKING_MINUTES = 480;
const DEFAULT_BREAK_MINUTES = 60;

type WorkPatternFailureClassification =
  | "validation"
  | "conflict"
  | "not_found"
  | "state_error"
  | "invariant"
  | "unknown";

interface NormalizedCreateWorkPatternCommand {
  readonly patternCode?: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly timezone: typeof WORK_PATTERN_TIMEZONE;
  readonly startLocalTime: string;
  readonly endLocalTime: string;
  readonly workingMinutes: number;
  readonly breakMinutes: number;
  readonly workingDays: readonly WorkPatternWeekdayToken[];
  readonly description: string | null;
  readonly externalRef: string | null;
}

interface NormalizedUpdateWorkPatternCommand {
  readonly workPatternId: string;
  readonly name?: string;
  readonly normalizedName?: string;
  readonly timezone?: typeof WORK_PATTERN_TIMEZONE;
  readonly startLocalTime?: string;
  readonly workingMinutes?: number;
  readonly breakMinutes?: number;
  readonly workingDays?: readonly WorkPatternWeekdayToken[];
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export class WorkPatternAdminService {
  constructor(
    private readonly repository: WorkPatternRepository,
    private readonly codeSequenceRepository: WorkScheduleCodeSequenceRepository,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly logger: StructuredLogger = createStructuredLogger(),
  ) {}

  async createWorkPattern(
    actor: Actor,
    command: CreateWorkPatternCommand,
  ): Promise<WorkPatternMutationResult> {
    const operation = "work-schedule.pattern.create";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_UPDATE,
    );
    const input =
      normalizeCreateWorkPatternCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        patternCode: input.patternCode ?? null,
      },
      async (session) => {
        if (input.patternCode !== undefined) {
          const existing =
            await this.repository.findByPatternCode(
              input.patternCode,
              session,
            );

          if (existing) {
            throw new WorkScheduleConflictError(
              `Work pattern code already exists: ${input.patternCode}`,
            );
          }
        }

        const now = Date.now();
        let created!: WorkPatternRecord;
        const maxCreateAttempts =
          input.patternCode === undefined ? 5 : 1;

        for (
          let attempt = 1;
          attempt <= maxCreateAttempts;
          attempt += 1
        ) {
          const patternCode =
            input.patternCode ??
            (await this.allocateGeneratedPatternCode(
              session,
            ));
          const record: WorkPatternRecord = {
            workPatternId: crypto.randomUUID(),
            patternCode,
            normalizedPatternCode:
              canonicalizeSearchToken(patternCode),
            name: input.name,
            normalizedName: input.normalizedName,
            status: "DRAFT",
            timezone: input.timezone,
            startLocalTime: input.startLocalTime,
            endLocalTime: input.endLocalTime,
            workingMinutes: input.workingMinutes,
            breakMinutes: input.breakMinutes,
            workingDays: [...input.workingDays],
            description: input.description,
            externalRef: input.externalRef,
            activatedAt: null,
            archivedAt: null,
            createdAt: now,
            updatedAt: now,
          };

          try {
            created = await this.repository.insert(
              record,
              session,
            );
            break;
          } catch (error) {
            if (!isDuplicateKeyError(error)) {
              throw error;
            }

            if (input.patternCode !== undefined) {
              throw new WorkScheduleConflictError(
                `Work pattern code already exists: ${input.patternCode}`,
              );
            }

            if (attempt === maxCreateAttempts) {
              throw new WorkScheduleConflictError(
                "Generated work pattern code conflict detected on create",
              );
            }
          }
        }

        await this.recordAudit({
          actor,
          permission,
          workPatternId: created.workPatternId,
          mutationType: operation,
          metadata: {
            patternCode: created.patternCode,
            status: created.status,
          },
          session,
        });

        return toWorkPatternMutationView(created);
      },
      (result) => ({
        workPatternId: result.workPatternId,
        status: result.status,
      }),
    );
  }

  async updateWorkPattern(
    actor: Actor,
    command: UpdateWorkPatternCommand,
  ): Promise<WorkPatternMutationResult> {
    const operation = "work-schedule.pattern.update";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_UPDATE,
    );
    const input =
      normalizeUpdateWorkPatternCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        workPatternId: input.workPatternId,
      },
      async (session, controls) => {
        const current =
          await this.requireWorkPattern(
            input.workPatternId,
            session,
          );

        if (current.status === "ARCHIVED") {
          throw new WorkScheduleStateError(
            "ARCHIVED work patterns are read-only",
          );
        }

        const patch = buildWorkPatternPatch({
          current,
          input,
        });
        const changedFields =
          summarizeChangedPatternFields(patch);

        if (changedFields.length === 0) {
          controls.markExplicitNoOpSuccess();
          return toWorkPatternMutationView(current);
        }

        const structuralFields =
          changedFields.filter((field) =>
            isStructuralPatternField(field),
          );

        if (
          current.status === "ACTIVE" &&
          structuralFields.length > 0
        ) {
          throw new WorkScheduleStateError(
            `ACTIVE work patterns allow metadata edits only; structural field(s) rejected: ${structuralFields.join(", ")}`,
          );
        }

        const updated =
          await this.repository.update(
            patch,
            session,
          );

        if (!updated) {
          throw new WorkScheduleConflictError(
            `Failed to update work pattern: ${current.workPatternId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          workPatternId: updated.workPatternId,
          mutationType: operation,
          metadata: {
            changedFields,
            status: updated.status,
          },
          session,
        });

        return toWorkPatternMutationView(updated);
      },
      (result) => ({
        workPatternId: result.workPatternId,
        status: result.status,
      }),
    );
  }

  async activateWorkPattern(
    actor: Actor,
    command: WorkPatternLifecycleCommand,
  ): Promise<WorkPatternMutationResult> {
    const operation = "work-schedule.pattern.activate";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
    );
    const workPatternId = normalizeRequiredText(
      command.workPatternId,
      "workPatternId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      { workPatternId },
      async (session) => {
        const current =
          await this.requireWorkPattern(
            workPatternId,
            session,
          );

        if (current.status !== "DRAFT") {
          throw new WorkScheduleStateError(
            `activateWorkPattern requires status DRAFT, received ${current.status}`,
          );
        }

        assertPersistedPatternIsValid(current);

        const now = Date.now();
        const updated =
          await this.repository.transitionStatus(
            {
              workPatternId,
              fromStatuses: ["DRAFT"],
              toStatus: "ACTIVE",
              updatedAt: now,
              activatedAt: now,
            },
            session,
          );

        if (!updated) {
          throw new WorkScheduleConflictError(
            `Failed to activate work pattern: ${workPatternId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          workPatternId: updated.workPatternId,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
          },
          session,
        });

        return toWorkPatternMutationView(updated);
      },
      (result) => ({
        workPatternId: result.workPatternId,
        status: result.status,
      }),
    );
  }

  async archiveWorkPattern(
    actor: Actor,
    command: WorkPatternLifecycleCommand,
  ): Promise<WorkPatternMutationResult> {
    const operation = "work-schedule.pattern.archive";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
    );
    const workPatternId = normalizeRequiredText(
      command.workPatternId,
      "workPatternId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      { workPatternId },
      async (session) => {
        const current =
          await this.requireWorkPattern(
            workPatternId,
            session,
          );

        if (current.status === "ARCHIVED") {
          throw new WorkScheduleStateError(
            "ARCHIVED work patterns cannot transition",
          );
        }

        const now = Date.now();
        const updated =
          await this.repository.transitionStatus(
            {
              workPatternId,
              fromStatuses: ["DRAFT", "ACTIVE"],
              toStatus: "ARCHIVED",
              updatedAt: now,
              archivedAt: now,
            },
            session,
          );

        if (!updated) {
          throw new WorkScheduleConflictError(
            `Failed to archive work pattern: ${workPatternId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          workPatternId: updated.workPatternId,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
          },
          session,
        });

        return toWorkPatternMutationView(updated);
      },
      (result) => ({
        workPatternId: result.workPatternId,
        status: result.status,
      }),
    );
  }

  private async allocateGeneratedPatternCode(
    session: ClientSession,
  ): Promise<string> {
    const sequence =
      await this.codeSequenceRepository.allocateNextWorkPatternCode(
        session,
      );

    return formatGeneratedPatternCode(sequence);
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

  private async requireWorkPattern(
    workPatternId: string,
    session: ClientSession,
  ): Promise<WorkPatternRecord> {
    const workPattern =
      await this.repository.findById(
        workPatternId,
        session,
      );

    if (!workPattern) {
      throw new WorkScheduleNotFoundError(
        workPatternId,
      );
    }

    return workPattern;
  }

  private async recordAudit(params: {
    readonly actor: Actor;
    readonly permission: PermissionContract;
    readonly workPatternId: string;
    readonly mutationType: AuthoritativeAdminMutationIdentity;
    readonly metadata: Readonly<
      Record<string, unknown>
    >;
    readonly session: ClientSession;
  }): Promise<void> {
    await this.audit.record(
      params.actor,
      params.permission,
      params.workPatternId,
      {
        mutationType: params.mutationType,
        targetId: params.workPatternId,
        targetType: "work-pattern",
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
    startMetadata: Readonly<
      Record<string, unknown>
    >,
    fn: (
      session: ClientSession,
      controls: AuthoritativeMutationControls,
    ) => Promise<T>,
    onSuccess: (
      result: T,
    ) => Readonly<Record<string, unknown>>,
  ): Promise<T> {
    this.logMutationEvent(
      actor,
      operation,
      "mutation.start",
      startMetadata,
    );

    try {
      const traceId = getTraceIdOrThrow();
      const result =
        await this.mutationBridge.execute(
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
            classifyWorkPatternMutationFailure(
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
    status:
      | "mutation.start"
      | "mutation.success",
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

function normalizeCreateWorkPatternCommand(
  command: CreateWorkPatternCommand,
): NormalizedCreateWorkPatternCommand {
  const patternCode = normalizeOptionalCreateCode(
    command.patternCode,
    "patternCode",
  );
  const name = normalizeRequiredText(
    command.name,
    "name",
  );
  const timezone = normalizeTimezone(
    command.timezone,
  );
  const startLocalTime = normalizeLocalTime(
    command.startLocalTime,
    "startLocalTime",
  );
  const workingMinutes =
    normalizeIntegerWithDefault(
      command.workingMinutes,
      "workingMinutes",
      DEFAULT_WORKING_MINUTES,
      1,
    );
  const breakMinutes =
    normalizeIntegerWithDefault(
      command.breakMinutes,
      "breakMinutes",
      DEFAULT_BREAK_MINUTES,
      0,
    );
  const endLocalTime = calculateEndLocalTime({
    startLocalTime,
    workingMinutes,
    breakMinutes,
  });

  return {
    patternCode,
    name,
    normalizedName: canonicalizeSearchToken(name),
    timezone,
    startLocalTime,
    endLocalTime,
    workingMinutes,
    breakMinutes,
    workingDays: normalizeWorkingDays(
      command.workingDays,
      "workingDays",
    ),
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
  };
}

function normalizeUpdateWorkPatternCommand(
  command: UpdateWorkPatternCommand,
): NormalizedUpdateWorkPatternCommand {
  const name = normalizeOptionalNonNullableText(
    command.name,
    "name",
  );

  return {
    workPatternId: normalizeRequiredText(
      command.workPatternId,
      "workPatternId",
    ),
    name,
    normalizedName:
      name === undefined
        ? undefined
        : canonicalizeSearchToken(name),
    timezone:
      command.timezone === undefined
        ? undefined
        : normalizeTimezone(command.timezone),
    startLocalTime:
      command.startLocalTime === undefined
        ? undefined
        : normalizeLocalTime(
            command.startLocalTime,
            "startLocalTime",
          ),
    workingMinutes:
      command.workingMinutes === undefined
        ? undefined
        : normalizePositiveInteger(
            command.workingMinutes,
            "workingMinutes",
          ),
    breakMinutes:
      command.breakMinutes === undefined
        ? undefined
        : normalizeNonNegativeInteger(
            command.breakMinutes,
            "breakMinutes",
          ),
    workingDays:
      command.workingDays === undefined
        ? undefined
        : normalizeWorkingDays(
            command.workingDays,
            "workingDays",
          ),
    description:
      normalizeOptionalNullableText(
        command.description,
        "description",
      ),
    externalRef:
      normalizeOptionalNullableText(
        command.externalRef,
        "externalRef",
      ),
  };
}

function buildWorkPatternPatch(params: {
  readonly current: WorkPatternRecord;
  readonly input: NormalizedUpdateWorkPatternCommand;
}): UpdateWorkPatternInput {
  const candidateStartLocalTime =
    params.input.startLocalTime ??
    params.current.startLocalTime;
  const candidateWorkingMinutes =
    params.input.workingMinutes ??
    params.current.workingMinutes;
  const candidateBreakMinutes =
    params.input.breakMinutes ??
    params.current.breakMinutes;
  const candidateEndLocalTime =
    calculateEndLocalTime({
      startLocalTime: candidateStartLocalTime,
      workingMinutes: candidateWorkingMinutes,
      breakMinutes: candidateBreakMinutes,
    });
  const patch: {
    workPatternId: string;
    updatedAt: number;
    name?: string;
    normalizedName?: string;
    startLocalTime?: string;
    endLocalTime?: string;
    workingMinutes?: number;
    breakMinutes?: number;
    workingDays?: readonly WorkPatternWeekdayToken[];
    description?: string | null;
    externalRef?: string | null;
  } = {
    workPatternId: params.current.workPatternId,
    updatedAt: Date.now(),
  };

  if (
    params.input.name !== undefined &&
    params.input.name !== params.current.name
  ) {
    patch.name = params.input.name;
    patch.normalizedName =
      params.input.normalizedName;
  }

  if (
    params.input.startLocalTime !== undefined &&
    candidateStartLocalTime !==
      params.current.startLocalTime
  ) {
    patch.startLocalTime = candidateStartLocalTime;
  }

  if (
    candidateEndLocalTime !==
      params.current.endLocalTime &&
    (params.input.startLocalTime !== undefined ||
      params.input.workingMinutes !== undefined ||
      params.input.breakMinutes !== undefined)
  ) {
    patch.endLocalTime = candidateEndLocalTime;
  }

  if (
    params.input.workingMinutes !== undefined &&
    candidateWorkingMinutes !==
      params.current.workingMinutes
  ) {
    patch.workingMinutes = candidateWorkingMinutes;
  }

  if (
    params.input.breakMinutes !== undefined &&
    candidateBreakMinutes !==
      params.current.breakMinutes
  ) {
    patch.breakMinutes = candidateBreakMinutes;
  }

  if (
    params.input.workingDays !== undefined &&
    !areWeekdaySetsEqual(
      params.input.workingDays,
      params.current.workingDays,
    )
  ) {
    patch.workingDays = [
      ...params.input.workingDays,
    ];
  }

  if (
    params.input.description !== undefined &&
    params.input.description !==
      params.current.description
  ) {
    patch.description = params.input.description;
  }

  if (
    params.input.externalRef !== undefined &&
    params.input.externalRef !==
      params.current.externalRef
  ) {
    patch.externalRef = params.input.externalRef;
  }

  return patch;
}

function summarizeChangedPatternFields(
  patch: UpdateWorkPatternInput,
): readonly string[] {
  const changedFields: string[] = [];

  if (patch.name !== undefined) {
    changedFields.push("name");
  }

  if (patch.startLocalTime !== undefined) {
    changedFields.push("startLocalTime");
  }

  if (patch.endLocalTime !== undefined) {
    changedFields.push("endLocalTime");
  }

  if (patch.workingMinutes !== undefined) {
    changedFields.push("workingMinutes");
  }

  if (patch.breakMinutes !== undefined) {
    changedFields.push("breakMinutes");
  }

  if (patch.workingDays !== undefined) {
    changedFields.push("workingDays");
  }

  if (patch.description !== undefined) {
    changedFields.push("description");
  }

  if (patch.externalRef !== undefined) {
    changedFields.push("externalRef");
  }

  return changedFields;
}

function isStructuralPatternField(
  field: string,
): boolean {
  return (
    field === "startLocalTime" ||
    field === "endLocalTime" ||
    field === "workingMinutes" ||
    field === "breakMinutes" ||
    field === "workingDays"
  );
}

function assertPersistedPatternIsValid(
  record: WorkPatternRecord,
): void {
  normalizeLocalTime(
    record.startLocalTime,
    "startLocalTime",
  );
  calculateEndLocalTime({
    startLocalTime: record.startLocalTime,
    workingMinutes: record.workingMinutes,
    breakMinutes: record.breakMinutes,
  });
  normalizeWorkingDays(
    record.workingDays,
    "workingDays",
  );

  if (
    record.timezone !== WORK_PATTERN_TIMEZONE
  ) {
    throw new WorkScheduleValidationError(
      `timezone must be ${WORK_PATTERN_TIMEZONE}`,
    );
  }
}

function normalizeRequiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new WorkScheduleValidationError(
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
    throw new WorkScheduleValidationError(
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

function normalizeOptionalCreateCode(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeTimezone(
  value: unknown,
): typeof WORK_PATTERN_TIMEZONE {
  if (value === undefined || value === null) {
    return WORK_PATTERN_TIMEZONE;
  }

  if (value !== WORK_PATTERN_TIMEZONE) {
    throw new WorkScheduleValidationError(
      `timezone must be ${WORK_PATTERN_TIMEZONE}`,
    );
  }

  return WORK_PATTERN_TIMEZONE;
}

function normalizeLocalTime(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `${field} must be a local HH:mm time`,
    );
  }

  const normalized = value.trim();
  const match =
    /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(
      normalized,
    );

  if (!match) {
    throw new WorkScheduleValidationError(
      `${field} must be a valid HH:mm 24-hour local time`,
    );
  }

  return normalized;
}

function normalizeIntegerWithDefault(
  value: unknown,
  field: string,
  defaultValue: number,
  minValue: number,
): number {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  return normalizeIntegerAtLeast(
    value,
    field,
    minValue,
  );
}

function normalizePositiveInteger(
  value: unknown,
  field: string,
): number {
  return normalizeIntegerAtLeast(value, field, 1);
}

function normalizeNonNegativeInteger(
  value: unknown,
  field: string,
): number {
  return normalizeIntegerAtLeast(value, field, 0);
}

function normalizeIntegerAtLeast(
  value: unknown,
  field: string,
  minValue: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minValue
  ) {
    throw new WorkScheduleValidationError(
      `${field} must be an integer greater than or equal to ${minValue}`,
    );
  }

  return value;
}

function calculateEndLocalTime(params: {
  readonly startLocalTime: string;
  readonly workingMinutes: number;
  readonly breakMinutes: number;
}): string {
  const start = parseLocalTimeMinutes(
    params.startLocalTime,
  );
  const total =
    start +
    params.workingMinutes +
    params.breakMinutes;

  if (total >= 24 * 60) {
    throw new WorkScheduleValidationError(
      "Work pattern window must end within the same local calendar date; overnight patterns are not supported in MVP-A",
    );
  }

  return formatLocalTimeMinutes(total);
}

function parseLocalTimeMinutes(value: string): number {
  const [hourText, minuteText] = value.split(":");
  return (
    Number(hourText) * 60 +
    Number(minuteText)
  );
}

function formatLocalTimeMinutes(
  value: number,
): string {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeWorkingDays(
  value: unknown,
  field: string,
): readonly WorkPatternWeekdayToken[] {
  if (!Array.isArray(value)) {
    throw new WorkScheduleValidationError(
      `${field} must be an array`,
    );
  }

  if (value.length === 0) {
    throw new WorkScheduleValidationError(
      `${field} must contain at least one weekday`,
    );
  }

  const seen = new Set<WorkPatternWeekdayToken>();

  for (
    let index = 0;
    index < value.length;
    index += 1
  ) {
    const item = value[index];

    if (typeof item !== "string") {
      throw new WorkScheduleValidationError(
        `${field}[${index}] must be one of ${WORK_PATTERN_WEEKDAY_TOKENS.join(", ")}`,
      );
    }

    const normalized = item.trim().toUpperCase();

    if (
      !WORK_PATTERN_WEEKDAY_TOKENS.includes(
        normalized as WorkPatternWeekdayToken,
      )
    ) {
      throw new WorkScheduleValidationError(
        `${field}[${index}] must be one of ${WORK_PATTERN_WEEKDAY_TOKENS.join(", ")}`,
      );
    }

    if (seen.has(normalized as WorkPatternWeekdayToken)) {
      throw new WorkScheduleValidationError(
        `${field} must not contain duplicate weekday tokens`,
      );
    }

    seen.add(normalized as WorkPatternWeekdayToken);
  }

  return WORK_PATTERN_WEEKDAY_TOKENS.filter((day) =>
    seen.has(day),
  );
}

function areWeekdaySetsEqual(
  left: readonly WorkPatternWeekdayToken[],
  right: readonly WorkPatternWeekdayToken[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (
    let index = 0;
    index < left.length;
    index += 1
  ) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function canonicalizeSearchToken(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function formatGeneratedPatternCode(
  sequence: number,
): string {
  return `WP-${String(sequence).padStart(6, "0")}`;
}

function assertAdminActorType(
  actor: Actor,
): void {
  if (actor.type === "admin") {
    return;
  }

  throw new SystemInvariantError(
    "PERMISSION_DENIED",
    `Work pattern access requires actor.type admin, received ${actor.type}`,
  );
}

function toWorkPatternMutationView(
  record: WorkPatternRecord,
): WorkPatternMutationView {
  return {
    workPatternId: record.workPatternId,
    patternCode: record.patternCode,
    name: record.name,
    status: record.status,
    timezone: record.timezone,
    startLocalTime: record.startLocalTime,
    endLocalTime: record.endLocalTime,
    workingMinutes: record.workingMinutes,
    breakMinutes: record.breakMinutes,
    workingDays: [...record.workingDays],
    description: record.description,
    externalRef: record.externalRef,
    activatedAt: record.activatedAt,
    archivedAt: record.archivedAt,
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
  metadata: Readonly<
    Record<string, unknown>
  >,
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

function classifyWorkPatternMutationFailure(
  error: unknown,
): WorkPatternFailureClassification {
  if (
    error instanceof WorkScheduleValidationError
  ) {
    return "validation";
  }

  if (
    error instanceof WorkScheduleConflictError
  ) {
    return "conflict";
  }

  if (
    error instanceof WorkScheduleNotFoundError
  ) {
    return "not_found";
  }

  if (error instanceof WorkScheduleStateError) {
    return "state_error";
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
