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
  HolidayCalendarRepository,
  UpdateHolidayCalendarEntryInput,
  UpdateHolidayCalendarInput,
} from "@modules/work-schedule/domain/work-schedule.repository";
import {
  HOLIDAY_CALENDAR_ENTRY_TYPES,
  HOLIDAY_CALENDAR_SCOPE_TYPES,
  HOLIDAY_CALENDAR_TIMEZONE,
  HolidayCalendarEntryRecord,
  HolidayCalendarEntryType,
  HolidayCalendarMutationView,
  HolidayCalendarRecord,
} from "@modules/work-schedule/domain/work-schedule.types";
import {
  AddHolidayCalendarEntryCommand,
  CreateHolidayCalendarCommand,
  HolidayCalendarLifecycleCommand,
  HolidayCalendarMutationResult,
  RemoveHolidayCalendarEntryCommand,
  UpdateHolidayCalendarCommand,
  UpdateHolidayCalendarEntryCommand,
} from "@modules/work-schedule/shared/work-schedule.contracts";

type HolidayCalendarFailureClassification =
  | "validation"
  | "conflict"
  | "not_found"
  | "state_error"
  | "invariant"
  | "unknown";

interface NormalizedCreateHolidayCalendarCommand {
  readonly calendarCode?: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly scopeType: "GLOBAL";
  readonly timezone: typeof HOLIDAY_CALENDAR_TIMEZONE;
  readonly description: string | null;
  readonly externalRef: string | null;
}

interface NormalizedUpdateHolidayCalendarCommand {
  readonly holidayCalendarId: string;
  readonly name?: string;
  readonly normalizedName?: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

interface NormalizedAddHolidayCalendarEntryCommand {
  readonly holidayCalendarId: string;
  readonly date: string;
  readonly entryType: HolidayCalendarEntryType;
  readonly name: string;
  readonly description: string | null;
  readonly externalRef: string | null;
}

interface NormalizedUpdateHolidayCalendarEntryCommand {
  readonly holidayCalendarId: string;
  readonly holidayCalendarEntryId: string;
  readonly date?: string;
  readonly entryType?: HolidayCalendarEntryType;
  readonly name?: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export class HolidayCalendarAdminService {
  constructor(
    private readonly repository: HolidayCalendarRepository,
    private readonly codeSequenceRepository: WorkScheduleCodeSequenceRepository,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly logger: StructuredLogger = createStructuredLogger(),
  ) {}

  async createHolidayCalendar(
    actor: Actor,
    command: CreateHolidayCalendarCommand,
  ): Promise<HolidayCalendarMutationResult> {
    const operation =
      "work-schedule.holiday-calendar.create";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_UPDATE,
    );
    const input =
      normalizeCreateHolidayCalendarCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      { calendarCode: input.calendarCode ?? null },
      async (session) => {
        if (input.calendarCode !== undefined) {
          const existing =
            await this.repository.findByCalendarCode(
              input.calendarCode,
              session,
            );

          if (existing) {
            throw new WorkScheduleConflictError(
              `Holiday calendar code already exists: ${input.calendarCode}`,
            );
          }
        }

        const now = Date.now();
        let created!: HolidayCalendarRecord;
        const maxCreateAttempts =
          input.calendarCode === undefined ? 5 : 1;

        for (
          let attempt = 1;
          attempt <= maxCreateAttempts;
          attempt += 1
        ) {
          const calendarCode =
            input.calendarCode ??
            (await this.allocateGeneratedCalendarCode(
              session,
            ));
          const record: HolidayCalendarRecord = {
            holidayCalendarId: crypto.randomUUID(),
            calendarCode,
            normalizedCalendarCode:
              canonicalizeSearchToken(calendarCode),
            name: input.name,
            normalizedName: input.normalizedName,
            scopeType: input.scopeType,
            timezone: input.timezone,
            status: "DRAFT",
            entries: [],
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

            if (input.calendarCode !== undefined) {
              throw new WorkScheduleConflictError(
                `Holiday calendar code already exists: ${input.calendarCode}`,
              );
            }

            if (attempt === maxCreateAttempts) {
              throw new WorkScheduleConflictError(
                "Generated holiday calendar code conflict detected on create",
              );
            }
          }
        }

        await this.recordAudit({
          actor,
          permission,
          holidayCalendarId:
            created.holidayCalendarId,
          mutationType: operation,
          metadata: {
            calendarCode: created.calendarCode,
            status: created.status,
          },
          session,
        });

        return toHolidayCalendarMutationView(created);
      },
      (result) => ({
        holidayCalendarId: result.holidayCalendarId,
        status: result.status,
      }),
    );
  }

  async updateHolidayCalendar(
    actor: Actor,
    command: UpdateHolidayCalendarCommand,
  ): Promise<HolidayCalendarMutationResult> {
    const operation =
      "work-schedule.holiday-calendar.update";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_UPDATE,
    );
    const input =
      normalizeUpdateHolidayCalendarCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      { holidayCalendarId: input.holidayCalendarId },
      async (session, controls) => {
        const current =
          await this.requireHolidayCalendar(
            input.holidayCalendarId,
            session,
          );

        if (current.status === "ARCHIVED") {
          throw new WorkScheduleStateError(
            "ARCHIVED holiday calendars are read-only",
          );
        }

        const patch = buildCalendarPatch({
          current,
          input,
        });
        const changedFields =
          summarizeChangedCalendarFields(patch);

        if (changedFields.length === 0) {
          controls.markExplicitNoOpSuccess();
          return toHolidayCalendarMutationView(current);
        }

        const updated = await this.repository.update(
          patch,
          session,
        );

        if (!updated) {
          throw new WorkScheduleConflictError(
            `Failed to update holiday calendar: ${current.holidayCalendarId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          holidayCalendarId:
            updated.holidayCalendarId,
          mutationType: operation,
          metadata: {
            changedFields,
            status: updated.status,
          },
          session,
        });

        return toHolidayCalendarMutationView(updated);
      },
      (result) => ({
        holidayCalendarId: result.holidayCalendarId,
        status: result.status,
      }),
    );
  }

  async activateHolidayCalendar(
    actor: Actor,
    command: HolidayCalendarLifecycleCommand,
  ): Promise<HolidayCalendarMutationResult> {
    const operation =
      "work-schedule.holiday-calendar.activate";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
    );
    const holidayCalendarId = normalizeRequiredText(
      command.holidayCalendarId,
      "holidayCalendarId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      { holidayCalendarId },
      async (session) => {
        const current =
          await this.requireHolidayCalendar(
            holidayCalendarId,
            session,
          );

        if (current.status !== "DRAFT") {
          throw new WorkScheduleStateError(
            `activateHolidayCalendar requires status DRAFT, received ${current.status}`,
          );
        }

        assertPersistedCalendarIsValid(current);

        const now = Date.now();
        const updated =
          await this.repository.transitionStatus(
            {
              holidayCalendarId,
              fromStatuses: ["DRAFT"],
              toStatus: "ACTIVE",
              updatedAt: now,
              activatedAt: now,
            },
            session,
          );

        if (!updated) {
          throw new WorkScheduleConflictError(
            `Failed to activate holiday calendar: ${holidayCalendarId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          holidayCalendarId:
            updated.holidayCalendarId,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
          },
          session,
        });

        return toHolidayCalendarMutationView(updated);
      },
      (result) => ({
        holidayCalendarId: result.holidayCalendarId,
        status: result.status,
      }),
    );
  }

  async archiveHolidayCalendar(
    actor: Actor,
    command: HolidayCalendarLifecycleCommand,
  ): Promise<HolidayCalendarMutationResult> {
    const operation =
      "work-schedule.holiday-calendar.archive";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
    );
    const holidayCalendarId = normalizeRequiredText(
      command.holidayCalendarId,
      "holidayCalendarId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      { holidayCalendarId },
      async (session) => {
        const current =
          await this.requireHolidayCalendar(
            holidayCalendarId,
            session,
          );

        if (current.status === "ARCHIVED") {
          throw new WorkScheduleStateError(
            "ARCHIVED holiday calendars cannot transition",
          );
        }

        const now = Date.now();
        const updated =
          await this.repository.transitionStatus(
            {
              holidayCalendarId,
              fromStatuses: ["DRAFT", "ACTIVE"],
              toStatus: "ARCHIVED",
              updatedAt: now,
              archivedAt: now,
            },
            session,
          );

        if (!updated) {
          throw new WorkScheduleConflictError(
            `Failed to archive holiday calendar: ${holidayCalendarId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          holidayCalendarId:
            updated.holidayCalendarId,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
          },
          session,
        });

        return toHolidayCalendarMutationView(updated);
      },
      (result) => ({
        holidayCalendarId: result.holidayCalendarId,
        status: result.status,
      }),
    );
  }

  async addHolidayCalendarEntry(
    actor: Actor,
    command: AddHolidayCalendarEntryCommand,
  ): Promise<HolidayCalendarMutationResult> {
    const operation =
      "work-schedule.holiday-calendar.entry.add";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_UPDATE,
    );
    const input =
      normalizeAddHolidayCalendarEntryCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        holidayCalendarId: input.holidayCalendarId,
        date: input.date,
      },
      async (session) => {
        const current =
          await this.requireMutableCalendar(
            input.holidayCalendarId,
            session,
          );
        assertNoDuplicateActiveDate(
          current,
          input.date,
        );

        const now = Date.now();
        const entry: HolidayCalendarEntryRecord = {
          holidayCalendarEntryId: crypto.randomUUID(),
          date: input.date,
          entryType: input.entryType,
          name: input.name,
          status: "ACTIVE",
          description: input.description,
          externalRef: input.externalRef,
          removedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        const updated = await this.repository.addEntry(
          {
            holidayCalendarId: input.holidayCalendarId,
            entry,
            updatedAt: now,
          },
          session,
        );

        if (!updated) {
          throw new WorkScheduleConflictError(
            `Failed to add holiday calendar entry for date: ${input.date}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          holidayCalendarId:
            updated.holidayCalendarId,
          mutationType: operation,
          metadata: {
            holidayCalendarEntryId:
              entry.holidayCalendarEntryId,
            date: entry.date,
            entryType: entry.entryType,
          },
          session,
        });

        return toHolidayCalendarMutationView(updated);
      },
      (result) => ({
        holidayCalendarId: result.holidayCalendarId,
        status: result.status,
      }),
    );
  }

  async updateHolidayCalendarEntry(
    actor: Actor,
    command: UpdateHolidayCalendarEntryCommand,
  ): Promise<HolidayCalendarMutationResult> {
    const operation =
      "work-schedule.holiday-calendar.entry.update";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_UPDATE,
    );
    const input =
      normalizeUpdateHolidayCalendarEntryCommand(
        command,
      );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        holidayCalendarId: input.holidayCalendarId,
        holidayCalendarEntryId:
          input.holidayCalendarEntryId,
      },
      async (session, controls) => {
        const current =
          await this.requireMutableCalendar(
            input.holidayCalendarId,
            session,
          );
        const entry = requireEntry(
          current,
          input.holidayCalendarEntryId,
        );

        if (entry.status !== "ACTIVE") {
          throw new WorkScheduleStateError(
            "REMOVED holiday calendar entries cannot be updated or reactivated in MVP-A",
          );
        }

        if (
          input.date !== undefined &&
          input.date !== entry.date
        ) {
          assertNoDuplicateActiveDate(
            current,
            input.date,
            input.holidayCalendarEntryId,
          );
        }

        const patch = buildEntryPatch({
          current: entry,
          input,
        });
        const changedFields =
          summarizeChangedEntryFields(patch);

        if (changedFields.length === 0) {
          controls.markExplicitNoOpSuccess();
          return toHolidayCalendarMutationView(current);
        }

        const updated =
          await this.repository.updateEntry(
            patch,
            session,
          );

        if (!updated) {
          throw new WorkScheduleConflictError(
            `Failed to update holiday calendar entry: ${input.holidayCalendarEntryId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          holidayCalendarId:
            updated.holidayCalendarId,
          mutationType: operation,
          metadata: {
            holidayCalendarEntryId:
              input.holidayCalendarEntryId,
            changedFields,
          },
          session,
        });

        return toHolidayCalendarMutationView(updated);
      },
      (result) => ({
        holidayCalendarId: result.holidayCalendarId,
        status: result.status,
      }),
    );
  }

  async removeHolidayCalendarEntry(
    actor: Actor,
    command: RemoveHolidayCalendarEntryCommand,
  ): Promise<HolidayCalendarMutationResult> {
    const operation =
      "work-schedule.holiday-calendar.entry.remove";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_UPDATE,
    );
    const holidayCalendarId = normalizeRequiredText(
      command.holidayCalendarId,
      "holidayCalendarId",
    );
    const holidayCalendarEntryId =
      normalizeRequiredText(
        command.holidayCalendarEntryId,
        "holidayCalendarEntryId",
      );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        holidayCalendarId,
        holidayCalendarEntryId,
      },
      async (session) => {
        const current =
          await this.requireMutableCalendar(
            holidayCalendarId,
            session,
          );
        const entry = requireEntry(
          current,
          holidayCalendarEntryId,
        );

        if (entry.status !== "ACTIVE") {
          throw new WorkScheduleStateError(
            "Only ACTIVE holiday calendar entries can be removed",
          );
        }

        const now = Date.now();
        const updated =
          await this.repository.removeEntry(
            {
              holidayCalendarId,
              holidayCalendarEntryId,
              updatedAt: now,
              removedAt: now,
            },
            session,
          );

        if (!updated) {
          throw new WorkScheduleConflictError(
            `Failed to remove holiday calendar entry: ${holidayCalendarEntryId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          holidayCalendarId:
            updated.holidayCalendarId,
          mutationType: operation,
          metadata: {
            holidayCalendarEntryId,
            date: entry.date,
          },
          session,
        });

        return toHolidayCalendarMutationView(updated);
      },
      (result) => ({
        holidayCalendarId: result.holidayCalendarId,
        status: result.status,
      }),
    );
  }

  private async allocateGeneratedCalendarCode(
    session: ClientSession,
  ): Promise<string> {
    const sequence =
      await this.codeSequenceRepository.allocateNextHolidayCalendarCode(
        session,
      );

    return formatGeneratedCalendarCode(sequence);
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

  private async requireHolidayCalendar(
    holidayCalendarId: string,
    session: ClientSession,
  ): Promise<HolidayCalendarRecord> {
    const calendar =
      await this.repository.findById(
        holidayCalendarId,
        session,
      );

    if (!calendar) {
      throw new WorkScheduleNotFoundError(
        holidayCalendarId,
      );
    }

    return calendar;
  }

  private async requireMutableCalendar(
    holidayCalendarId: string,
    session: ClientSession,
  ): Promise<HolidayCalendarRecord> {
    const calendar =
      await this.requireHolidayCalendar(
        holidayCalendarId,
        session,
      );

    if (calendar.status === "ARCHIVED") {
      throw new WorkScheduleStateError(
        "ARCHIVED holiday calendars are read-only",
      );
    }

    return calendar;
  }

  private async recordAudit(params: {
    readonly actor: Actor;
    readonly permission: PermissionContract;
    readonly holidayCalendarId: string;
    readonly mutationType: AuthoritativeAdminMutationIdentity;
    readonly metadata: Readonly<
      Record<string, unknown>
    >;
    readonly session: ClientSession;
  }): Promise<void> {
    await this.audit.record(
      params.actor,
      params.permission,
      params.holidayCalendarId,
      {
        mutationType: params.mutationType,
        targetId: params.holidayCalendarId,
        targetType: "holiday-calendar",
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
            classifyHolidayCalendarMutationFailure(
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

function normalizeCreateHolidayCalendarCommand(
  command: CreateHolidayCalendarCommand,
): NormalizedCreateHolidayCalendarCommand {
  const calendarCode = normalizeOptionalCreateCode(
    command.calendarCode,
    "calendarCode",
  );
  const name = normalizeRequiredText(
    command.name,
    "name",
  );

  return {
    calendarCode,
    name,
    normalizedName: canonicalizeSearchToken(name),
    scopeType: normalizeScopeType(command.scopeType),
    timezone: normalizeTimezone(command.timezone),
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

function normalizeUpdateHolidayCalendarCommand(
  command: UpdateHolidayCalendarCommand,
): NormalizedUpdateHolidayCalendarCommand {
  const name = normalizeOptionalNonNullableText(
    command.name,
    "name",
  );

  return {
    holidayCalendarId: normalizeRequiredText(
      command.holidayCalendarId,
      "holidayCalendarId",
    ),
    name,
    normalizedName:
      name === undefined
        ? undefined
        : canonicalizeSearchToken(name),
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

function normalizeAddHolidayCalendarEntryCommand(
  command: AddHolidayCalendarEntryCommand,
): NormalizedAddHolidayCalendarEntryCommand {
  return {
    holidayCalendarId: normalizeRequiredText(
      command.holidayCalendarId,
      "holidayCalendarId",
    ),
    date: normalizeDateOnly(command.date),
    entryType: normalizeEntryType(command.entryType),
    name: normalizeRequiredText(
      command.name,
      "name",
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

function normalizeUpdateHolidayCalendarEntryCommand(
  command: UpdateHolidayCalendarEntryCommand,
): NormalizedUpdateHolidayCalendarEntryCommand {
  return {
    holidayCalendarId: normalizeRequiredText(
      command.holidayCalendarId,
      "holidayCalendarId",
    ),
    holidayCalendarEntryId: normalizeRequiredText(
      command.holidayCalendarEntryId,
      "holidayCalendarEntryId",
    ),
    date:
      command.date === undefined
        ? undefined
        : normalizeDateOnly(command.date),
    entryType:
      command.entryType === undefined
        ? undefined
        : normalizeEntryType(command.entryType),
    name: normalizeOptionalNonNullableText(
      command.name,
      "name",
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

function buildCalendarPatch(params: {
  readonly current: HolidayCalendarRecord;
  readonly input: NormalizedUpdateHolidayCalendarCommand;
}): UpdateHolidayCalendarInput {
  const patch: {
    holidayCalendarId: string;
    updatedAt: number;
    name?: string;
    normalizedName?: string;
    description?: string | null;
    externalRef?: string | null;
  } = {
    holidayCalendarId:
      params.current.holidayCalendarId,
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

function buildEntryPatch(params: {
  readonly current: HolidayCalendarEntryRecord;
  readonly input: NormalizedUpdateHolidayCalendarEntryCommand;
}): UpdateHolidayCalendarEntryInput {
  const patch: {
    holidayCalendarId: string;
    holidayCalendarEntryId: string;
    updatedAt: number;
    date?: string;
    entryType?: HolidayCalendarEntryType;
    name?: string;
    description?: string | null;
    externalRef?: string | null;
  } = {
    holidayCalendarId:
      params.input.holidayCalendarId,
    holidayCalendarEntryId:
      params.input.holidayCalendarEntryId,
    updatedAt: Date.now(),
  };

  if (
    params.input.date !== undefined &&
    params.input.date !== params.current.date
  ) {
    patch.date = params.input.date;
  }

  if (
    params.input.entryType !== undefined &&
    params.input.entryType !==
      params.current.entryType
  ) {
    patch.entryType = params.input.entryType;
  }

  if (
    params.input.name !== undefined &&
    params.input.name !== params.current.name
  ) {
    patch.name = params.input.name;
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

function summarizeChangedCalendarFields(
  patch: UpdateHolidayCalendarInput,
): readonly string[] {
  const fields: string[] = [];

  if (patch.name !== undefined) {
    fields.push("name");
  }

  if (patch.description !== undefined) {
    fields.push("description");
  }

  if (patch.externalRef !== undefined) {
    fields.push("externalRef");
  }

  return fields;
}

function summarizeChangedEntryFields(
  patch: UpdateHolidayCalendarEntryInput,
): readonly string[] {
  const fields: string[] = [];

  if (patch.date !== undefined) {
    fields.push("date");
  }

  if (patch.entryType !== undefined) {
    fields.push("entryType");
  }

  if (patch.name !== undefined) {
    fields.push("name");
  }

  if (patch.description !== undefined) {
    fields.push("description");
  }

  if (patch.externalRef !== undefined) {
    fields.push("externalRef");
  }

  return fields;
}

function assertPersistedCalendarIsValid(
  record: HolidayCalendarRecord,
): void {
  if (record.scopeType !== "GLOBAL") {
    throw new WorkScheduleValidationError(
      "scopeType must be GLOBAL",
    );
  }

  if (
    record.timezone !== HOLIDAY_CALENDAR_TIMEZONE
  ) {
    throw new WorkScheduleValidationError(
      `timezone must be ${HOLIDAY_CALENDAR_TIMEZONE}`,
    );
  }

  const activeDates = new Set<string>();

  for (const entry of record.entries) {
    normalizeDateOnly(entry.date);
    normalizeEntryType(entry.entryType);

    if (entry.status === "ACTIVE") {
      if (activeDates.has(entry.date)) {
        throw new WorkScheduleConflictError(
          `Duplicate ACTIVE holiday calendar entry date: ${entry.date}`,
        );
      }

      activeDates.add(entry.date);
    }
  }
}

function assertNoDuplicateActiveDate(
  calendar: HolidayCalendarRecord,
  date: string,
  excludeEntryId?: string,
): void {
  const duplicate = calendar.entries.some(
    (entry) =>
      entry.status === "ACTIVE" &&
      entry.date === date &&
      entry.holidayCalendarEntryId !== excludeEntryId,
  );

  if (duplicate) {
    throw new WorkScheduleConflictError(
      `Holiday calendar already has an ACTIVE entry for date: ${date}`,
    );
  }
}

function requireEntry(
  calendar: HolidayCalendarRecord,
  holidayCalendarEntryId: string,
): HolidayCalendarEntryRecord {
  const entry = calendar.entries.find(
    (candidate) =>
      candidate.holidayCalendarEntryId ===
      holidayCalendarEntryId,
  );

  if (!entry) {
    throw new WorkScheduleNotFoundError(
      holidayCalendarEntryId,
    );
  }

  return entry;
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

function normalizeScopeType(
  value: unknown,
): "GLOBAL" {
  if (value === undefined || value === null) {
    return "GLOBAL";
  }

  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `scopeType must be one of ${HOLIDAY_CALENDAR_SCOPE_TYPES.join(", ")}`,
    );
  }

  const normalized = value
    .trim()
    .toUpperCase();

  if (normalized !== "GLOBAL") {
    throw new WorkScheduleValidationError(
      "Only GLOBAL holiday calendars are supported in MVP-A",
    );
  }

  return "GLOBAL";
}

function normalizeTimezone(
  value: unknown,
): typeof HOLIDAY_CALENDAR_TIMEZONE {
  if (value === undefined || value === null) {
    return HOLIDAY_CALENDAR_TIMEZONE;
  }

  if (value !== HOLIDAY_CALENDAR_TIMEZONE) {
    throw new WorkScheduleValidationError(
      `timezone must be ${HOLIDAY_CALENDAR_TIMEZONE}`,
    );
  }

  return HOLIDAY_CALENDAR_TIMEZONE;
}

function normalizeEntryType(
  value: unknown,
): HolidayCalendarEntryType {
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `entryType must be one of ${HOLIDAY_CALENDAR_ENTRY_TYPES.join(", ")}`,
    );
  }

  const normalized = value
    .trim()
    .toUpperCase();

  if (
    HOLIDAY_CALENDAR_ENTRY_TYPES.includes(
      normalized as HolidayCalendarEntryType,
    )
  ) {
    return normalized as HolidayCalendarEntryType;
  }

  throw new WorkScheduleValidationError(
    `entryType must be one of ${HOLIDAY_CALENDAR_ENTRY_TYPES.join(", ")}`,
  );
}

function normalizeDateOnly(value: unknown): string {
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      "date must be a valid date-only YYYY-MM-DD string",
    );
  }

  const normalized = value.trim();
  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/u.exec(
      normalized,
    );

  if (!match) {
    throw new WorkScheduleValidationError(
      "date must be a valid date-only YYYY-MM-DD string",
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(
    Date.UTC(year, month - 1, day),
  );

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new WorkScheduleValidationError(
      "date must be a real calendar date",
    );
  }

  return normalized;
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

function formatGeneratedCalendarCode(
  sequence: number,
): string {
  return `HC-${String(sequence).padStart(6, "0")}`;
}

function assertAdminActorType(
  actor: Actor,
): void {
  if (actor.type === "admin") {
    return;
  }

  throw new SystemInvariantError(
    "PERMISSION_DENIED",
    `Holiday calendar access requires actor.type admin, received ${actor.type}`,
  );
}

function toHolidayCalendarMutationView(
  record: HolidayCalendarRecord,
): HolidayCalendarMutationView {
  return {
    holidayCalendarId: record.holidayCalendarId,
    calendarCode: record.calendarCode,
    name: record.name,
    scopeType: record.scopeType,
    timezone: record.timezone,
    status: record.status,
    entries: record.entries.map((entry) => ({
      ...entry,
    })),
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

function classifyHolidayCalendarMutationFailure(
  error: unknown,
): HolidayCalendarFailureClassification {
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
