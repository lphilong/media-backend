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
  assertRosterMonthWithinPlanningWindow,
  assertWorkScheduleDateOnlyWithinRosterMonth,
  normalizeWorkScheduleDateOnly,
} from "@modules/work-schedule/domain/work-schedule-date";
import {
  buildMonthlyRosterPreview,
  rosterMonthUtcWindow,
} from "@modules/work-schedule/domain/work-schedule-roster-preview";
import { WorkScheduleEmploymentProfileReadonlyAccess } from "@modules/work-schedule/domain/work-schedule-employment-profile-readonly-access";
import { WorkScheduleOrgUnitReadonlyAccess } from "@modules/work-schedule/domain/work-schedule-org-unit-readonly-access";
import { WorkScheduleStudioResourceReadonlyAccess } from "@modules/work-schedule/domain/work-schedule-studio-resource-readonly-access";
import {
  WorkScheduleConflictError,
  WorkScheduleInvalidResourceReferenceError,
  WorkScheduleInvalidSubjectReferenceError,
  WorkScheduleNotFoundError,
  WorkScheduleOverlapConflictError,
  WorkSchedulePermissionScopeError,
  WorkScheduleStateError,
  WorkScheduleValidationError,
} from "@modules/work-schedule/domain/work-schedule.errors";
import { WorkScheduleCodeSequenceRepository } from "@modules/work-schedule/domain/work-schedule-code-sequence.repository";
import {
  HolidayCalendarRepository,
  MonthlyRosterRepository,
  UpdateMonthlyRosterDraftInput,
  UpdateRosterExceptionInput,
  WorkPatternRepository,
  WorkShiftRepository,
} from "@modules/work-schedule/domain/work-schedule.repository";
import {
  HOLIDAY_CALENDAR_TIMEZONE,
  MONTHLY_ROSTER_TARGET_ORG_UNIT_MODE,
  MONTHLY_ROSTER_TARGET_SUBJECT_KIND,
  MONTHLY_ROSTER_TIMEZONE,
  ROSTER_EXCEPTION_TYPES,
  MonthlyRosterMutationView,
  MonthlyRosterPreviewRowView,
  MonthlyRosterRecord,
  RosterExceptionRecord,
  RosterExceptionType,
  WorkPatternRecord,
  WorkPatternWeekdayToken,
  WorkShiftRecord,
  WorkShiftScope,
} from "@modules/work-schedule/domain/work-schedule.types";
import {
  AddRosterExceptionCommand,
  CreateMonthlyRosterDraftCommand,
  MonthlyRosterLifecycleCommand,
  MonthlyRosterMutationResult,
  PublishMonthlyRosterCommand,
  PublishMonthlyRosterResult,
  RemoveRosterExceptionCommand,
  UpdateMonthlyRosterDraftCommand,
  UpdateRosterExceptionCommand,
} from "@modules/work-schedule/shared/work-schedule.contracts";

type MonthlyRosterFailureClassification =
  | "validation"
  | "conflict"
  | "not_found"
  | "state_error"
  | "invalid_subject_reference"
  | "invalid_resource_reference"
  | "overlap_conflict"
  | "permission_scope"
  | "invariant"
  | "unknown";

interface NormalizedCreateMonthlyRosterDraftCommand {
  readonly rosterCode?: string;
  readonly rosterMonth: string;
  readonly timezone: typeof MONTHLY_ROSTER_TIMEZONE;
  readonly departmentOrgUnitId: string;
  readonly workPatternId: string;
  readonly holidayCalendarId: string;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly requestedScope?: WorkShiftScope;
}

interface NormalizedUpdateMonthlyRosterDraftCommand {
  readonly monthlyRosterId: string;
  readonly rosterMonth?: string;
  readonly timezone?: typeof MONTHLY_ROSTER_TIMEZONE;
  readonly departmentOrgUnitId?: string;
  readonly workPatternId?: string;
  readonly holidayCalendarId?: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly requestedScope?: WorkShiftScope;
}

interface NormalizedRosterExceptionCommand {
  readonly monthlyRosterId: string;
  readonly rosterExceptionId?: string;
  readonly exceptionType: RosterExceptionType;
  readonly exceptionDate: string;
  readonly subjectEmploymentProfileId: string;
  readonly title: string | null;
  readonly startLocalTime: string | null;
  readonly workingMinutes: number | null;
  readonly breakMinutes: number | null;
  readonly studioResourceIds: readonly string[];
  readonly reason: string | null;
  readonly sourceNote: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly requestedScope?: WorkShiftScope;
}

interface NormalizedRosterLifecycleCommand {
  readonly monthlyRosterId: string;
  readonly requestedScope?: WorkShiftScope;
}

interface NormalizedPublishMonthlyRosterCommand {
  readonly monthlyRosterId: string;
  readonly expectedPreviewHash?: string;
  readonly idempotencyKey: string | null;
  readonly note: string | null;
  readonly requestedScope?: WorkShiftScope;
}

export class MonthlyRosterAdminService {
  constructor(
    private readonly rosterRepository: MonthlyRosterRepository,
    private readonly workPatternRepository: WorkPatternRepository,
    private readonly holidayCalendarRepository: HolidayCalendarRepository,
    private readonly workShiftRepository: WorkShiftRepository,
    private readonly codeSequenceRepository: WorkScheduleCodeSequenceRepository,
    private readonly orgUnitReadonlyAccess: WorkScheduleOrgUnitReadonlyAccess,
    private readonly employmentProfileReadonlyAccess: WorkScheduleEmploymentProfileReadonlyAccess,
    private readonly studioResourceReadonlyAccess: WorkScheduleStudioResourceReadonlyAccess,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly logger: StructuredLogger = createStructuredLogger(),
    private readonly now: () => number = Date.now,
  ) {}

  async createMonthlyRosterDraft(
    actor: Actor,
    command: CreateMonthlyRosterDraftCommand,
  ): Promise<MonthlyRosterMutationResult> {
    const operation =
      "work-schedule.monthly-roster.create-draft";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_CREATE,
    );
    const input =
      normalizeCreateMonthlyRosterDraftCommand(command);
    assertRosterMonthWithinPlanningWindow(
      input.rosterMonth,
      this.now(),
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        rosterCode: input.rosterCode ?? null,
        rosterMonth: input.rosterMonth,
        departmentOrgUnitId:
          input.departmentOrgUnitId,
      },
      async (session) => {
        const scope =
          await this.resolveRosterScopeForDepartment(
            actor,
            input.requestedScope,
            input.departmentOrgUnitId,
            session,
          );
        await this.assertActiveDepartment(
          input.departmentOrgUnitId,
          session,
        );
        await this.requireActivePattern(
          input.workPatternId,
          session,
        );
        await this.requireActiveCalendar(
          input.holidayCalendarId,
          session,
        );
        if (input.rosterCode !== undefined) {
          await this.assertNoDuplicateRosterCode(
            input.rosterCode,
            session,
          );
        }
        await this.assertNoDuplicateActiveRoster(
          input.departmentOrgUnitId,
          input.rosterMonth,
          session,
        );

        const now = Date.now();
        let created!: MonthlyRosterRecord;
        const maxCreateAttempts =
          input.rosterCode === undefined ? 5 : 1;

        for (
          let attempt = 1;
          attempt <= maxCreateAttempts;
          attempt += 1
        ) {
          const rosterCode =
            input.rosterCode ??
            (await this.allocateGeneratedRosterCode(
              input.rosterMonth,
              session,
            ));
          const record: MonthlyRosterRecord = {
            monthlyRosterId: crypto.randomUUID(),
            rosterCode,
            normalizedRosterCode:
              canonicalizeSearchToken(rosterCode),
            rosterMonth: input.rosterMonth,
            timezone: input.timezone,
            targetSubjectKind:
              MONTHLY_ROSTER_TARGET_SUBJECT_KIND,
            targetOrgUnitMode:
              MONTHLY_ROSTER_TARGET_ORG_UNIT_MODE,
            departmentOrgUnitId:
              input.departmentOrgUnitId,
            workPatternId: input.workPatternId,
            holidayCalendarId:
              input.holidayCalendarId,
            status: "DRAFT",
            draftVersion: 1,
            previewHash: null,
            lastPreviewedAt: null,
            publishedAt: null,
            publishedByUserId: null,
            publishGenerationRunId: null,
            description: input.description,
            externalRef: input.externalRef,
            exceptions: [],
            archivedAt: null,
            createdAt: now,
            updatedAt: now,
          };

          try {
            created =
              await this.rosterRepository.insert(
                record,
                session,
              );
            break;
          } catch (error) {
            if (!isDuplicateKeyError(error)) {
              throw error;
            }

            if (input.rosterCode !== undefined) {
              const existing =
                await this.rosterRepository.findByRosterCode(
                  input.rosterCode,
                  session,
                );

              throw new WorkScheduleConflictError(
                existing
                  ? `Monthly roster code already exists: ${input.rosterCode}`
                  : "Monthly roster code or department/month guard already exists",
              );
            }

            if (attempt === maxCreateAttempts) {
              throw new WorkScheduleConflictError(
                "Generated monthly roster code conflict detected on create",
              );
            }

            await this.assertNoDuplicateActiveRoster(
              input.departmentOrgUnitId,
              input.rosterMonth,
              session,
            );
          }
        }

        await this.recordAudit({
          actor,
          permission,
          monthlyRosterId:
            created.monthlyRosterId,
          mutationType: operation,
          metadata: {
            rosterCode: created.rosterCode,
            rosterMonth: created.rosterMonth,
            departmentOrgUnitId:
              created.departmentOrgUnitId,
            effectiveScope: scope,
          },
          session,
        });

        return toMonthlyRosterMutationView(created);
      },
      (result) => ({
        monthlyRosterId: result.monthlyRosterId,
        status: result.status,
      }),
    );
  }

  async updateMonthlyRosterDraft(
    actor: Actor,
    command: UpdateMonthlyRosterDraftCommand,
  ): Promise<MonthlyRosterMutationResult> {
    const operation =
      "work-schedule.monthly-roster.update-draft";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_UPDATE,
    );
    const input =
      normalizeUpdateMonthlyRosterDraftCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      { monthlyRosterId: input.monthlyRosterId },
      async (session, controls) => {
        const current =
          await this.requireMonthlyRoster(
            input.monthlyRosterId,
            session,
          );

        assertDraftRoster(current);
        const candidateDepartmentOrgUnitId =
          input.departmentOrgUnitId ??
          current.departmentOrgUnitId;
        const candidateRosterMonth =
          input.rosterMonth ?? current.rosterMonth;
        if (
          input.rosterMonth !== undefined &&
          candidateRosterMonth !== current.rosterMonth
        ) {
          assertRosterMonthWithinPlanningWindow(
            candidateRosterMonth,
            this.now(),
          );
        }
        const candidateWorkPatternId =
          input.workPatternId ??
          current.workPatternId;
        const candidateHolidayCalendarId =
          input.holidayCalendarId ??
          current.holidayCalendarId;

        const scope =
          await this.resolveRosterScopeForDepartment(
            actor,
            input.requestedScope,
            candidateDepartmentOrgUnitId,
            session,
          );
        await this.assertActiveDepartment(
          candidateDepartmentOrgUnitId,
          session,
        );
        await this.requireActivePattern(
          candidateWorkPatternId,
          session,
        );
        await this.requireActiveCalendar(
          candidateHolidayCalendarId,
          session,
        );

        if (
          candidateDepartmentOrgUnitId !==
            current.departmentOrgUnitId ||
          candidateRosterMonth !== current.rosterMonth
        ) {
          await this.assertNoDuplicateActiveRoster(
            candidateDepartmentOrgUnitId,
            candidateRosterMonth,
            session,
            current.monthlyRosterId,
          );
        }

        const patch =
          buildMonthlyRosterDraftPatch({
            current,
            input,
          });
        const changedFields =
          summarizeMonthlyRosterPatch(patch);

        if (changedFields.length === 0) {
          controls.markExplicitNoOpSuccess();
          return toMonthlyRosterMutationView(current);
        }

        assertNoStructuralRosterDraftChangeWithActiveExceptions(
          current,
          changedFields,
        );

        const updated =
          await this.rosterRepository.updateDraft(
            patch,
            session,
          );

        if (!updated) {
          throw new WorkScheduleConflictError(
            `Failed to update monthly roster draft: ${current.monthlyRosterId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          monthlyRosterId:
            updated.monthlyRosterId,
          mutationType: operation,
          metadata: {
            changedFields,
            effectiveScope: scope,
          },
          session,
        });

        return toMonthlyRosterMutationView(updated);
      },
      (result) => ({
        monthlyRosterId: result.monthlyRosterId,
        status: result.status,
      }),
    );
  }

  async archiveMonthlyRoster(
    actor: Actor,
    command: MonthlyRosterLifecycleCommand,
  ): Promise<MonthlyRosterMutationResult> {
    const operation =
      "work-schedule.monthly-roster.archive";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
    );
    const input =
      normalizeRosterLifecycleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      { monthlyRosterId: input.monthlyRosterId },
      async (session) => {
        const current =
          await this.requireMonthlyRoster(
            input.monthlyRosterId,
            session,
          );

        if (current.status === "ARCHIVED") {
          throw new WorkScheduleStateError(
            "ARCHIVED monthly rosters cannot transition",
          );
        }

        const scope =
          await this.resolveRosterScopeForDepartment(
            actor,
            input.requestedScope,
            current.departmentOrgUnitId,
            session,
          );
        const now = Date.now();
        const updated =
          await this.rosterRepository.transitionStatus(
            {
              monthlyRosterId:
                current.monthlyRosterId,
              fromStatuses: [
                "DRAFT",
                "PUBLISHED",
                "LOCKED",
              ],
              toStatus: "ARCHIVED",
              updatedAt: now,
              archivedAt: now,
            },
            session,
          );

        if (!updated) {
          throw new WorkScheduleConflictError(
            `Failed to archive monthly roster: ${current.monthlyRosterId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          monthlyRosterId:
            updated.monthlyRosterId,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            effectiveScope: scope,
          },
          session,
        });

        return toMonthlyRosterMutationView(updated);
      },
      (result) => ({
        monthlyRosterId: result.monthlyRosterId,
        status: result.status,
      }),
    );
  }

  async publishMonthlyRoster(
    actor: Actor,
    command: PublishMonthlyRosterCommand,
  ): Promise<PublishMonthlyRosterResult> {
    const operation =
      "work-schedule.monthly-roster.publish";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
    );
    this.assertOfficialWorkShiftPublishAuthority(actor);
    const input =
      normalizePublishMonthlyRosterCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        monthlyRosterId: input.monthlyRosterId,
        expectedPreviewHash:
          input.expectedPreviewHash ?? null,
        idempotencyKey: input.idempotencyKey,
      },
      async (session, controls) => {
        const current =
          await this.requireMonthlyRoster(
            input.monthlyRosterId,
            session,
          );
        const scope =
          await this.resolveRosterScopeForDepartment(
            actor,
            input.requestedScope,
            current.departmentOrgUnitId,
            session,
          );

        if (current.status === "PUBLISHED") {
          controls.markExplicitNoOpSuccess();
          const existingSummary =
            await this.workShiftRepository.summarizeGeneratedByRoster(
              current.monthlyRosterId,
              session,
            );

          return buildPublishSummary({
            roster: current,
            generatedWorkShiftIds:
              existingSummary.workShiftIds,
            generatedWorkShiftCount:
              existingSummary.generatedWorkShiftCount,
            skippedWorkingToOffCount:
              current.exceptions.filter(
                (exception) =>
                  exception.status === "ACTIVE" &&
                  exception.exceptionType ===
                    "WORKING_TO_OFF",
              ).length,
            holidaySuppressedCount: 0,
            changeTimeCount:
              existingSummary.changeTimeCount,
            addSpecialShiftCount:
              existingSummary.addSpecialShiftCount,
            conflictCount: 0,
            computedPreviewHash:
              current.previewHash,
          });
        }

        assertDraftRoster(current);
        assertRosterMonthWithinPlanningWindow(
          current.rosterMonth,
          this.now(),
        );

        if (!input.expectedPreviewHash) {
          throw new WorkScheduleValidationError(
            "expectedPreviewHash is required to publish a DRAFT Monthly Roster",
          );
        }

        assertRosterPublishBaseState(current);
        await this.assertActiveDepartment(
          current.departmentOrgUnitId,
          session,
        );
        const pattern = await this.requireActivePattern(
          current.workPatternId,
          session,
        );
        const calendar =
          await this.requireActiveCalendar(
            current.holidayCalendarId,
            session,
          );
        const profiles = (
          await this.employmentProfileReadonlyAccess.listByOrgUnitId(
            current.departmentOrgUnitId,
            session,
          )
        )
          .filter(
            (profile) =>
              profile.employmentStatus === "ACTIVE" &&
              profile.orgUnitId ===
                current.departmentOrgUnitId,
          )
          .sort((left, right) =>
            left.id.localeCompare(right.id),
          );
        const monthWindow = rosterMonthUtcWindow(
          current.rosterMonth,
        );
        const activeShifts =
          await this.workShiftRepository.listActiveEmploymentProfileShiftsForWindow(
            {
              subjectEmploymentProfileIds:
                profiles.map((profile) => profile.id),
              windowStartAt: monthWindow.windowStartAt,
              windowEndAt: monthWindow.windowEndAt,
            },
            session,
          );
        const preview = buildMonthlyRosterPreview({
          roster: toMonthlyRosterMutationView(current),
          pattern,
          activeHolidayEntries: calendar.entries.filter(
            (entry) => entry.status === "ACTIVE",
          ),
          eligibleProfiles: profiles.map((profile) => ({
            id: profile.id,
            employmentStatus: "ACTIVE",
            orgUnitId: profile.orgUnitId,
          })),
          existingActiveShifts: activeShifts,
        });

        if (
          preview.computedPreviewHash !==
          input.expectedPreviewHash
        ) {
          throw new WorkScheduleConflictError(
            "expectedPreviewHash does not match the current Monthly Roster preview",
          );
        }

        if (
          current.previewHash !== null &&
          current.previewHash !==
            preview.computedPreviewHash
        ) {
          throw new WorkScheduleConflictError(
            "Stored Monthly Roster previewHash is stale; re-preview before publish",
          );
        }

        assertPreviewCanPublish(preview);

        const publishableRows = preview.rows.filter(
          (row) => row.isCandidateShift,
        );
        const sourceGenerationRunId =
          buildGenerationRunId(current.monthlyRosterId, input);
        const now = Date.now();
        const generatedWorkShiftIds: string[] = [];

        for (const row of publishableRows) {
          await this.assertGeneratedRowInsertIsStillSafe(
            row,
            current,
            session,
          );
          const record =
            await this.buildGeneratedWorkShiftRecord({
              roster: current,
              row,
              sourceGenerationRunId,
              now,
              session,
            });

          try {
            const created =
              await this.workShiftRepository.insert(
                record,
                session,
              );
            generatedWorkShiftIds.push(created.id);
          } catch (error) {
            if (isDuplicateKeyError(error)) {
              throw new WorkScheduleConflictError(
                "Generated Work Shift duplicate detected during Monthly Roster publish",
              );
            }

            throw error;
          }
        }

        const published =
          await this.rosterRepository.publish(
            {
              monthlyRosterId:
                current.monthlyRosterId,
              fromStatus: "DRAFT",
              updatedAt: now,
              publishedAt: now,
              publishedByUserId: actor.id,
              publishGenerationRunId:
                sourceGenerationRunId,
              previewHash:
                preview.computedPreviewHash,
              lastPreviewedAt: now,
            },
            session,
          );

        if (!published) {
          throw new WorkScheduleConflictError(
            `Failed to publish monthly roster: ${current.monthlyRosterId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          monthlyRosterId:
            published.monthlyRosterId,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: published.status,
            generatedWorkShiftCount:
              generatedWorkShiftIds.length,
            computedPreviewHash:
              preview.computedPreviewHash,
            sourceGenerationRunId,
            effectiveScope: scope,
            idempotencyKey: input.idempotencyKey,
            note: input.note,
          },
          session,
        });

        return buildPublishSummary({
          roster: published,
          generatedWorkShiftIds,
          generatedWorkShiftCount:
            generatedWorkShiftIds.length,
          skippedWorkingToOffCount:
            preview.summary.totalWorkingToOff,
          holidaySuppressedCount:
            preview.summary.totalHolidaySuppressions,
          changeTimeCount:
            preview.summary.totalChangeTime,
          addSpecialShiftCount:
            preview.summary.totalAddSpecialShift,
          conflictCount: 0,
          computedPreviewHash:
            preview.computedPreviewHash,
        });
      },
      (result) => ({
        monthlyRosterId: result.monthlyRosterId,
        status: result.status,
        generatedWorkShiftCount:
          result.generatedWorkShiftCount,
      }),
    );
  }

  async addRosterException(
    actor: Actor,
    command: AddRosterExceptionCommand,
  ): Promise<MonthlyRosterMutationResult> {
    const operation =
      "work-schedule.monthly-roster.exception.add";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_UPDATE,
    );
    const input = normalizeRosterExceptionCommand(
      command,
      false,
    );

    return this.executeExceptionMutation({
      actor,
      permission,
      operation,
      input,
      create: true,
    });
  }

  async updateRosterException(
    actor: Actor,
    command: UpdateRosterExceptionCommand,
  ): Promise<MonthlyRosterMutationResult> {
    const operation =
      "work-schedule.monthly-roster.exception.update";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_UPDATE,
    );
    const input = normalizeRosterExceptionCommand(
      command,
      true,
    );

    return this.executeExceptionMutation({
      actor,
      permission,
      operation,
      input,
      create: false,
    });
  }

  async removeRosterException(
    actor: Actor,
    command: RemoveRosterExceptionCommand,
  ): Promise<MonthlyRosterMutationResult> {
    const operation =
      "work-schedule.monthly-roster.exception.remove";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_UPDATE,
    );
    const monthlyRosterId = normalizeRequiredText(
      command.monthlyRosterId,
      "monthlyRosterId",
    );
    const rosterExceptionId = normalizeRequiredText(
      command.rosterExceptionId,
      "rosterExceptionId",
    );
    const requestedScope = parseRequestedScope(
      command.scope,
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      { monthlyRosterId, rosterExceptionId },
      async (session) => {
        const current =
          await this.requireMonthlyRoster(
            monthlyRosterId,
            session,
          );
        assertDraftRoster(current);
        const exception =
          requireActiveException(
            current,
            rosterExceptionId,
          );
        const scope =
          await this.resolveRosterScopeForDepartment(
            actor,
            requestedScope,
            current.departmentOrgUnitId,
            session,
          );
        const now = Date.now();
        const updated =
          await this.rosterRepository.removeException(
            {
              monthlyRosterId,
              rosterExceptionId,
              updatedAt: now,
              removedAt: now,
            },
            session,
          );

        if (!updated) {
          throw new WorkScheduleConflictError(
            `Failed to remove roster exception: ${rosterExceptionId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          monthlyRosterId:
            updated.monthlyRosterId,
          mutationType: operation,
          metadata: {
            rosterExceptionId,
            exceptionType:
              exception.exceptionType,
            effectiveScope: scope,
          },
          session,
        });

        return toMonthlyRosterMutationView(updated);
      },
      (result) => ({
        monthlyRosterId: result.monthlyRosterId,
        status: result.status,
      }),
    );
  }

  private async executeExceptionMutation(params: {
    readonly actor: Actor;
    readonly permission: PermissionContract;
    readonly operation: AuthoritativeAdminMutationIdentity;
    readonly input: NormalizedRosterExceptionCommand;
    readonly create: boolean;
  }): Promise<MonthlyRosterMutationResult> {
    return this.executeMutation(
      params.actor,
      params.permission,
      params.operation,
      {
        monthlyRosterId: params.input.monthlyRosterId,
        rosterExceptionId:
          params.input.rosterExceptionId ?? null,
        exceptionType: params.input.exceptionType,
        exceptionDate: params.input.exceptionDate,
      },
      async (session, controls) => {
        const current =
          await this.requireMonthlyRoster(
            params.input.monthlyRosterId,
            session,
          );
        assertDraftRoster(current);
        const scope =
          await this.resolveRosterScopeForDepartment(
            params.actor,
            params.input.requestedScope,
            current.departmentOrgUnitId,
            session,
          );
        const pattern = await this.requireActivePattern(
          current.workPatternId,
          session,
        );
        const calendar =
          await this.requireActiveCalendar(
            current.holidayCalendarId,
            session,
          );

        assertDateWithinRosterMonth(
          params.input.exceptionDate,
          current.rosterMonth,
        );
        await this.assertEligibleEmploymentProfile(
          params.input.subjectEmploymentProfileId,
          current.departmentOrgUnitId,
          session,
        );
        this.assertExceptionPayloadValidForType(
          params.input,
          pattern,
        );
        assertNoContradictoryStandardException(
          current,
          params.input,
        );

        if (
          params.input.exceptionType !==
          "ADD_SPECIAL_SHIFT"
        ) {
          assertStandardRosterCandidate({
            date: params.input.exceptionDate,
            pattern,
            calendar,
          });
        } else {
          await this.assertSpecialShiftNoConflicts(
            params.input,
            session,
          );
        }

        const now = Date.now();

        if (params.create) {
          const exception =
            buildRosterExceptionRecord({
              input: params.input,
              monthlyRosterId:
                current.monthlyRosterId,
              pattern,
              now,
            });
          const updated =
            await this.rosterRepository.addException(
              {
                monthlyRosterId:
                  current.monthlyRosterId,
                exception,
                updatedAt: now,
              },
              session,
            );

          if (!updated) {
            throw new WorkScheduleConflictError(
              "Failed to add roster exception",
            );
          }

          await this.recordAudit({
            actor: params.actor,
            permission: params.permission,
            monthlyRosterId:
              updated.monthlyRosterId,
            mutationType: params.operation,
            metadata: {
              rosterExceptionId:
                exception.rosterExceptionId,
              exceptionType:
                exception.exceptionType,
              effectiveScope: scope,
            },
            session,
          });

          return toMonthlyRosterMutationView(updated);
        }

        const existing = requireActiveException(
          current,
          params.input.rosterExceptionId as string,
        );
        const patch = buildRosterExceptionPatch({
          existing,
          input: params.input,
          pattern,
          now,
        });

        if (
          summarizeRosterExceptionPatch(patch)
            .length === 0
        ) {
          controls.markExplicitNoOpSuccess();
          return toMonthlyRosterMutationView(current);
        }

        const updated =
          await this.rosterRepository.updateException(
            patch,
            session,
          );

        if (!updated) {
          throw new WorkScheduleConflictError(
            `Failed to update roster exception: ${params.input.rosterExceptionId}`,
          );
        }

        await this.recordAudit({
          actor: params.actor,
          permission: params.permission,
          monthlyRosterId:
            updated.monthlyRosterId,
          mutationType: params.operation,
          metadata: {
            rosterExceptionId:
              params.input.rosterExceptionId,
            exceptionType:
              params.input.exceptionType,
            effectiveScope: scope,
          },
          session,
        });

        return toMonthlyRosterMutationView(updated);
      },
      (result) => ({
        monthlyRosterId: result.monthlyRosterId,
        status: result.status,
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

  private assertOfficialWorkShiftPublishAuthority(
    actor: Actor,
  ): void {
    if (
      PermissionGuard.hasWorkScheduleScopeGrant(
        actor,
        "global",
      )
    ) {
      return;
    }

    throw new WorkSchedulePermissionScopeError(
      "Monthly Roster publish creates official WorkShifts and requires workSchedule.global scope",
    );
  }

  private async requireMonthlyRoster(
    monthlyRosterId: string,
    session: ClientSession,
  ): Promise<MonthlyRosterRecord> {
    const roster =
      await this.rosterRepository.findById(
        monthlyRosterId,
        session,
      );

    if (!roster) {
      throw new WorkScheduleNotFoundError(
        monthlyRosterId,
      );
    }

    return roster;
  }

  private async assertActiveDepartment(
    departmentOrgUnitId: string,
    session: ClientSession,
  ): Promise<void> {
    const orgUnit =
      await this.orgUnitReadonlyAccess.findById(
        departmentOrgUnitId,
        session,
      );

    if (!orgUnit) {
      throw new WorkScheduleInvalidSubjectReferenceError(
        `Roster target Org Unit does not exist: ${departmentOrgUnitId}`,
      );
    }

    if (orgUnit.type !== "DEPARTMENT") {
      throw new WorkScheduleInvalidSubjectReferenceError(
        `Roster target Org Unit must be type DEPARTMENT: ${departmentOrgUnitId}`,
      );
    }

    if (orgUnit.status !== "ACTIVE") {
      throw new WorkScheduleInvalidSubjectReferenceError(
        `Roster target Org Unit must be ACTIVE: ${departmentOrgUnitId}`,
      );
    }
  }

  private async requireActivePattern(
    workPatternId: string,
    session: ClientSession,
  ): Promise<WorkPatternRecord> {
    const pattern =
      await this.workPatternRepository.findById(
        workPatternId,
        session,
      );

    if (!pattern) {
      throw new WorkScheduleInvalidSubjectReferenceError(
        `Work Pattern does not exist: ${workPatternId}`,
      );
    }

    if (pattern.status !== "ACTIVE") {
      throw new WorkScheduleInvalidSubjectReferenceError(
        `Work Pattern must be ACTIVE for Monthly Roster use: ${workPatternId}`,
      );
    }

    return pattern;
  }

  private async requireActiveCalendar(
    holidayCalendarId: string,
    session: ClientSession,
  ) {
    const calendar =
      await this.holidayCalendarRepository.findById(
        holidayCalendarId,
        session,
      );

    if (!calendar) {
      throw new WorkScheduleInvalidSubjectReferenceError(
        `Holiday Calendar does not exist: ${holidayCalendarId}`,
      );
    }

    if (calendar.status !== "ACTIVE") {
      throw new WorkScheduleInvalidSubjectReferenceError(
        `Holiday Calendar must be ACTIVE for Monthly Roster use: ${holidayCalendarId}`,
      );
    }

    if (
      calendar.scopeType !== "GLOBAL" ||
      calendar.timezone !== HOLIDAY_CALENDAR_TIMEZONE
    ) {
      throw new WorkScheduleInvalidSubjectReferenceError(
        `Holiday Calendar must be GLOBAL and ${HOLIDAY_CALENDAR_TIMEZONE}: ${holidayCalendarId}`,
      );
    }

    return calendar;
  }

  private async assertEligibleEmploymentProfile(
    employmentProfileId: string,
    departmentOrgUnitId: string,
    session: ClientSession,
  ): Promise<void> {
    const profile =
      await this.employmentProfileReadonlyAccess.findById(
        employmentProfileId,
        session,
      );

    if (!profile) {
      throw new WorkScheduleInvalidSubjectReferenceError(
        `Employment Profile does not exist: ${employmentProfileId}`,
      );
    }

    if (profile.employmentStatus !== "ACTIVE") {
      throw new WorkScheduleInvalidSubjectReferenceError(
        `Employment Profile must be ACTIVE for Monthly Roster exceptions: ${employmentProfileId}`,
      );
    }

    if (profile.orgUnitId !== departmentOrgUnitId) {
      throw new WorkScheduleInvalidSubjectReferenceError(
        `Employment Profile must belong to exact roster department: ${employmentProfileId}`,
      );
    }
  }

  private async assertNoDuplicateRosterCode(
    rosterCode: string,
    session: ClientSession,
  ): Promise<void> {
    const existing =
      await this.rosterRepository.findByRosterCode(
        rosterCode,
        session,
      );

    if (existing) {
      throw new WorkScheduleConflictError(
        `Monthly roster code already exists: ${rosterCode}`,
      );
    }
  }

  private async assertNoDuplicateActiveRoster(
    departmentOrgUnitId: string,
    rosterMonth: string,
    session: ClientSession,
    excludeMonthlyRosterId?: string,
  ): Promise<void> {
    const existing =
      await this.rosterRepository.findActiveByDepartmentAndMonth(
        departmentOrgUnitId,
        rosterMonth,
        session,
      );

    if (
      existing &&
      existing.monthlyRosterId !==
        excludeMonthlyRosterId
    ) {
      throw new WorkScheduleConflictError(
        `A non-archived monthly roster already exists for department ${departmentOrgUnitId} and month ${rosterMonth}`,
      );
    }
  }

  private assertExceptionPayloadValidForType(
    input: NormalizedRosterExceptionCommand,
    pattern: WorkPatternRecord,
  ): void {
    if (input.exceptionType === "WORKING_TO_OFF") {
      if (
        input.title !== null ||
        input.startLocalTime !== null ||
        input.workingMinutes !== null ||
        input.breakMinutes !== null ||
        input.studioResourceIds.length > 0
      ) {
        throw new WorkScheduleValidationError(
          "WORKING_TO_OFF exceptions must not include time, duration, title, or resource fields",
        );
      }

      return;
    }

    if (input.exceptionType === "CHANGE_TIME") {
      if (input.startLocalTime === null) {
        throw new WorkScheduleValidationError(
          "CHANGE_TIME requires startLocalTime",
        );
      }

      if (
        input.title !== null ||
        input.workingMinutes !== null ||
        input.breakMinutes !== null ||
        input.studioResourceIds.length > 0
      ) {
        throw new WorkScheduleValidationError(
          "CHANGE_TIME exceptions must not include title, duration override, or resource fields in MVP-A",
        );
      }

      calculateEndLocalTime({
        startLocalTime: input.startLocalTime,
        workingMinutes: pattern.workingMinutes,
        breakMinutes: pattern.breakMinutes,
      });
      return;
    }

    if (!input.title) {
      throw new WorkScheduleValidationError(
        "ADD_SPECIAL_SHIFT requires title",
      );
    }

    if (input.startLocalTime === null) {
      throw new WorkScheduleValidationError(
        "ADD_SPECIAL_SHIFT requires startLocalTime",
      );
    }

    if (input.workingMinutes === null) {
      throw new WorkScheduleValidationError(
        "ADD_SPECIAL_SHIFT requires workingMinutes",
      );
    }

    if (input.breakMinutes === null) {
      throw new WorkScheduleValidationError(
        "ADD_SPECIAL_SHIFT requires breakMinutes",
      );
    }

    calculateEndLocalTime({
      startLocalTime: input.startLocalTime,
      workingMinutes: input.workingMinutes,
      breakMinutes: input.breakMinutes,
    });
  }

  private async assertSpecialShiftNoConflicts(
    input: NormalizedRosterExceptionCommand,
    session: ClientSession,
  ): Promise<void> {
    for (const studioResourceId of input.studioResourceIds) {
      const resource =
        await this.studioResourceReadonlyAccess.findById(
          studioResourceId,
          session,
        );

      if (!resource) {
        throw new WorkScheduleInvalidResourceReferenceError(
          `Studio resource does not exist: ${studioResourceId}`,
        );
      }

      if (resource.operationalStatus !== "ACTIVE") {
        throw new WorkScheduleInvalidResourceReferenceError(
          `Studio resource must be ACTIVE: ${studioResourceId}`,
        );
      }
    }

    const startLocalTime =
      input.startLocalTime as string;
    const endLocalTime = calculateEndLocalTime({
      startLocalTime,
      workingMinutes: input.workingMinutes as number,
      breakMinutes: input.breakMinutes as number,
    });
    const shiftStartAt = toVietnamLocalUtcMillis(
      input.exceptionDate,
      startLocalTime,
    );
    const shiftEndAt = toVietnamLocalUtcMillis(
      input.exceptionDate,
      endLocalTime,
    );
    const subjectOverlap =
      await this.workShiftRepository.hasActiveOverlappingSubjectShift(
        {
          subjectKind: "EMPLOYMENT_PROFILE",
          subjectEmploymentProfileId:
            input.subjectEmploymentProfileId,
          subjectTalentId: null,
          subjectTalentGroupId: null,
          shiftStartAt,
          shiftEndAt,
        },
        session,
      );

    if (subjectOverlap) {
      throw new WorkScheduleOverlapConflictError(
        "ADD_SPECIAL_SHIFT overlaps an existing ACTIVE Work Shift for the subject",
      );
    }

    const resourceOverlap =
      await this.workShiftRepository.hasActiveOverlappingResourceShift(
        {
          studioResourceIds:
            input.studioResourceIds,
          shiftStartAt,
          shiftEndAt,
        },
        session,
      );

    if (resourceOverlap) {
      throw new WorkScheduleOverlapConflictError(
        "ADD_SPECIAL_SHIFT overlaps an existing ACTIVE Work Shift for a Studio Resource",
      );
    }
  }

  private async assertGeneratedRowInsertIsStillSafe(
    row: MonthlyRosterPreviewRowView,
    roster: MonthlyRosterRecord,
    session: ClientSession,
  ): Promise<void> {
    if (
      !row.isCandidateShift ||
      row.shiftStartAt === null ||
      row.shiftEndAt === null ||
      row.sourceRosterSlotKey === null
    ) {
      throw new WorkScheduleValidationError(
        "Monthly Roster publish can create Work Shifts only from candidate preview rows",
      );
    }

    const exception = row.sourceExceptionId
      ? roster.exceptions.find(
          (candidate) =>
            candidate.rosterExceptionId ===
            row.sourceExceptionId,
        ) ?? null
      : null;
    const studioResourceIds =
      row.rowKind === "ADD_SPECIAL_SHIFT"
        ? (exception?.studioResourceIds ?? [])
        : [];
    const subjectOverlap =
      await this.workShiftRepository.hasActiveOverlappingSubjectShift(
        {
          subjectKind: "EMPLOYMENT_PROFILE",
          subjectEmploymentProfileId:
            row.subjectEmploymentProfileId,
          subjectTalentId: null,
          subjectTalentGroupId: null,
          shiftStartAt: row.shiftStartAt,
          shiftEndAt: row.shiftEndAt,
        },
        session,
      );

    if (subjectOverlap) {
      throw new WorkScheduleOverlapConflictError(
        "Generated Work Shift overlaps an existing ACTIVE Work Shift for the subject",
      );
    }

    const resourceOverlap =
      await this.workShiftRepository.hasActiveOverlappingResourceShift(
        {
          studioResourceIds,
          shiftStartAt: row.shiftStartAt,
          shiftEndAt: row.shiftEndAt,
        },
        session,
      );

    if (resourceOverlap) {
      throw new WorkScheduleOverlapConflictError(
        "Generated Work Shift overlaps an existing ACTIVE Work Shift for a Studio Resource",
      );
    }
  }

  private async buildGeneratedWorkShiftRecord(params: {
    readonly roster: MonthlyRosterRecord;
    readonly row: MonthlyRosterPreviewRowView;
    readonly sourceGenerationRunId: string;
    readonly now: number;
    readonly session: ClientSession;
  }): Promise<WorkShiftRecord> {
    if (
      params.row.shiftStartAt === null ||
      params.row.shiftEndAt === null ||
      params.row.sourceRosterSlotKey === null
    ) {
      throw new WorkScheduleValidationError(
        "Generated Work Shift row is missing required shift timing or slot metadata",
      );
    }

    const exception = params.row.sourceExceptionId
      ? params.roster.exceptions.find(
          (candidate) =>
            candidate.rosterExceptionId ===
            params.row.sourceExceptionId,
        ) ?? null
      : null;
    const shiftCode =
      await this.allocateGeneratedShiftCode(
        params.row.shiftStartAt,
        params.session,
      );
    const title =
      params.row.rowKind === "ADD_SPECIAL_SHIFT"
        ? (exception?.title ?? "Roster special shift")
        : "Roster shift";
    const description =
      params.row.rowKind === "ADD_SPECIAL_SHIFT"
        ? (exception?.description ??
          exception?.reason ??
          exception?.sourceNote ??
          null)
        : (exception?.reason ??
          exception?.sourceNote ??
          null);
    const externalRef =
      params.row.rowKind === "ADD_SPECIAL_SHIFT"
        ? (exception?.externalRef ?? null)
        : null;

    return {
      id: crypto.randomUUID(),
      shiftCode,
      normalizedShiftCode:
        canonicalizeSearchToken(shiftCode),
      title,
      normalizedTitle: canonicalizeSearchToken(title),
      subjectKind: "EMPLOYMENT_PROFILE",
      subjectEmploymentProfileId:
        params.row.subjectEmploymentProfileId,
      subjectTalentId: null,
      subjectTalentGroupId: null,
      studioResourceIds:
        params.row.rowKind === "ADD_SPECIAL_SHIFT"
          ? [...(exception?.studioResourceIds ?? [])]
          : [],
      status: "ACTIVE",
      shiftStartAt: params.row.shiftStartAt,
      shiftEndAt: params.row.shiftEndAt,
      description,
      externalRef,
      sourceType: "ROSTER_GENERATED",
      sourceRosterId: params.roster.monthlyRosterId,
      sourcePatternId: params.roster.workPatternId,
      sourceExceptionId: params.row.sourceExceptionId,
      sourceGenerationRunId:
        params.sourceGenerationRunId,
      sourceRosterMonth: params.roster.rosterMonth,
      sourceDepartmentOrgUnitId:
        params.roster.departmentOrgUnitId,
      sourceRosterLocalDate: params.row.localDate,
      sourceRosterSlotKey:
        params.row.sourceRosterSlotKey,
      createdAt: params.now,
      updatedAt: params.now,
    };
  }

  private async allocateGeneratedShiftCode(
    shiftStartAt: number,
    session: ClientSession,
  ): Promise<string> {
    const dateBucket =
      toUtcShiftCodeDateBucket(shiftStartAt);
    const sequence =
      await this.codeSequenceRepository.allocateNext(
        dateBucket,
        session,
      );

    return formatGeneratedShiftCode(
      dateBucket,
      sequence,
    );
  }

  private async allocateGeneratedRosterCode(
    rosterMonth: string,
    session: ClientSession,
  ): Promise<string> {
    const monthBucket =
      toRosterMonthCodeBucket(rosterMonth);
    const sequence =
      await this.codeSequenceRepository.allocateNextMonthlyRosterCode(
        monthBucket,
        session,
      );

    return formatGeneratedRosterCode(
      monthBucket,
      sequence,
    );
  }

  private async resolveRosterScopeForDepartment(
    actor: Actor,
    requestedScope: WorkShiftScope | undefined,
    _departmentOrgUnitId: string,
    _session: ClientSession,
  ): Promise<"global"> {
    if (
      requestedScope !== undefined &&
      requestedScope !== "global"
    ) {
      throw new WorkSchedulePermissionScopeError(
        "Admin Monthly Roster operations require workSchedule.global scope",
      );
    }

    if (
      !PermissionGuard.hasWorkScheduleScopeGrant(
        actor,
        "global",
      )
    ) {
      throw new WorkSchedulePermissionScopeError(
        "Admin Monthly Roster operations require workSchedule.global scope",
      );
    }

    return "global";
  }

  private async recordAudit(params: {
    readonly actor: Actor;
    readonly permission: PermissionContract;
    readonly monthlyRosterId: string;
    readonly mutationType: AuthoritativeAdminMutationIdentity;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly session: ClientSession;
  }): Promise<void> {
    await this.audit.record(
      params.actor,
      params.permission,
      params.monthlyRosterId,
      {
        mutationType: params.mutationType,
        targetId: params.monthlyRosterId,
        targetType: "monthly-roster",
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
            classifyMonthlyRosterMutationFailure(
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

function normalizeCreateMonthlyRosterDraftCommand(
  command: CreateMonthlyRosterDraftCommand,
): NormalizedCreateMonthlyRosterDraftCommand {
  const rosterCode = normalizeOptionalCreateCode(
    command.rosterCode,
    "rosterCode",
  );
  const rosterMonth = normalizeRosterMonth(
    command.rosterMonth,
  );

  return {
    rosterCode,
    rosterMonth,
    timezone: normalizeRosterTimezone(
      command.timezone,
    ),
    departmentOrgUnitId: normalizeRequiredText(
      command.departmentOrgUnitId,
      "departmentOrgUnitId",
    ),
    workPatternId: normalizeRequiredText(
      command.workPatternId,
      "workPatternId",
    ),
    holidayCalendarId: normalizeRequiredText(
      command.holidayCalendarId,
      "holidayCalendarId",
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
    requestedScope: parseRequestedScope(
      command.scope,
    ),
  };
}

function normalizeUpdateMonthlyRosterDraftCommand(
  command: UpdateMonthlyRosterDraftCommand,
): NormalizedUpdateMonthlyRosterDraftCommand {
  return {
    monthlyRosterId: normalizeRequiredText(
      command.monthlyRosterId,
      "monthlyRosterId",
    ),
    rosterMonth:
      command.rosterMonth === undefined
        ? undefined
        : normalizeRosterMonth(command.rosterMonth),
    timezone:
      command.timezone === undefined
        ? undefined
        : normalizeRosterTimezone(command.timezone),
    departmentOrgUnitId:
      command.departmentOrgUnitId === undefined
        ? undefined
        : normalizeRequiredText(
            command.departmentOrgUnitId,
            "departmentOrgUnitId",
          ),
    workPatternId:
      command.workPatternId === undefined
        ? undefined
        : normalizeRequiredText(
            command.workPatternId,
            "workPatternId",
          ),
    holidayCalendarId:
      command.holidayCalendarId === undefined
        ? undefined
        : normalizeRequiredText(
            command.holidayCalendarId,
            "holidayCalendarId",
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
    requestedScope: parseRequestedScope(
      command.scope,
    ),
  };
}

function normalizeRosterLifecycleCommand(
  command: MonthlyRosterLifecycleCommand,
): NormalizedRosterLifecycleCommand {
  return {
    monthlyRosterId: normalizeRequiredText(
      command.monthlyRosterId,
      "monthlyRosterId",
    ),
    requestedScope: parseRequestedScope(
      command.scope,
    ),
  };
}

function normalizePublishMonthlyRosterCommand(
  command: PublishMonthlyRosterCommand,
): NormalizedPublishMonthlyRosterCommand {
  return {
    monthlyRosterId: normalizeRequiredText(
      command.monthlyRosterId,
      "monthlyRosterId",
    ),
    expectedPreviewHash:
      command.expectedPreviewHash === undefined
        ? undefined
        : normalizeRequiredText(
            command.expectedPreviewHash,
            "expectedPreviewHash",
          ),
    idempotencyKey:
      normalizeOptionalNullableText(
        command.idempotencyKey,
        "idempotencyKey",
      ) ?? null,
    note:
      normalizeOptionalNullableText(
        command.note,
        "note",
      ) ?? null,
    requestedScope: parseRequestedScope(
      command.scope,
    ),
  };
}

function normalizeRosterExceptionCommand(
  command:
    | AddRosterExceptionCommand
    | UpdateRosterExceptionCommand,
  expectExceptionId: boolean,
): NormalizedRosterExceptionCommand {
  const exceptionType = normalizeExceptionType(
    command.exceptionType,
  );

  return {
    monthlyRosterId: normalizeRequiredText(
      command.monthlyRosterId,
      "monthlyRosterId",
    ),
    rosterExceptionId: expectExceptionId
      ? normalizeRequiredText(
          (command as UpdateRosterExceptionCommand)
            .rosterExceptionId,
          "rosterExceptionId",
        )
      : undefined,
    exceptionType,
    exceptionDate: normalizeDateOnly(
      command.exceptionDate,
      "exceptionDate",
    ),
    subjectEmploymentProfileId:
      normalizeRequiredText(
        command.subjectEmploymentProfileId,
        "subjectEmploymentProfileId",
      ),
    title:
      normalizeOptionalNullableText(
        command.title,
        "title",
      ) ?? null,
    startLocalTime:
      command.startLocalTime === undefined
        ? null
        : normalizeLocalTime(
            command.startLocalTime,
            "startLocalTime",
          ),
    workingMinutes:
      command.workingMinutes === undefined
        ? null
        : normalizePositiveInteger(
            command.workingMinutes,
            "workingMinutes",
          ),
    breakMinutes:
      command.breakMinutes === undefined
        ? null
        : normalizeNonNegativeInteger(
            command.breakMinutes,
            "breakMinutes",
          ),
    studioResourceIds:
      normalizeStudioResourceIds(
        command.studioResourceIds,
      ),
    reason:
      normalizeOptionalNullableText(
        command.reason,
        "reason",
      ) ?? null,
    sourceNote:
      normalizeOptionalNullableText(
        command.sourceNote,
        "sourceNote",
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
    requestedScope: parseRequestedScope(
      command.scope,
    ),
  };
}

function buildMonthlyRosterDraftPatch(params: {
  readonly current: MonthlyRosterRecord;
  readonly input: NormalizedUpdateMonthlyRosterDraftCommand;
}): UpdateMonthlyRosterDraftInput {
  const patch: {
    monthlyRosterId: string;
    updatedAt: number;
    rosterMonth?: string;
    departmentOrgUnitId?: string;
    workPatternId?: string;
    holidayCalendarId?: string;
    description?: string | null;
    externalRef?: string | null;
  } = {
    monthlyRosterId:
      params.current.monthlyRosterId,
    updatedAt: Date.now(),
  };

  if (
    params.input.rosterMonth !== undefined &&
    params.input.rosterMonth !==
      params.current.rosterMonth
  ) {
    patch.rosterMonth = params.input.rosterMonth;
  }

  if (
    params.input.departmentOrgUnitId !==
      undefined &&
    params.input.departmentOrgUnitId !==
      params.current.departmentOrgUnitId
  ) {
    patch.departmentOrgUnitId =
      params.input.departmentOrgUnitId;
  }

  if (
    params.input.workPatternId !== undefined &&
    params.input.workPatternId !==
      params.current.workPatternId
  ) {
    patch.workPatternId =
      params.input.workPatternId;
  }

  if (
    params.input.holidayCalendarId !==
      undefined &&
    params.input.holidayCalendarId !==
      params.current.holidayCalendarId
  ) {
    patch.holidayCalendarId =
      params.input.holidayCalendarId;
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

function summarizeMonthlyRosterPatch(
  patch: UpdateMonthlyRosterDraftInput,
): readonly string[] {
  const fields: string[] = [];

  for (const field of [
    "rosterMonth",
    "departmentOrgUnitId",
    "workPatternId",
    "holidayCalendarId",
    "description",
    "externalRef",
  ] as const) {
    if (patch[field] !== undefined) {
      fields.push(field);
    }
  }

  return fields;
}

function assertNoStructuralRosterDraftChangeWithActiveExceptions(
  roster: MonthlyRosterRecord,
  changedFields: readonly string[],
): void {
  const structuralFields: readonly string[] = [
    "rosterMonth",
    "departmentOrgUnitId",
    "workPatternId",
    "holidayCalendarId",
  ];
  const structuralChangeRequested = changedFields.some(
    (field) => structuralFields.includes(field),
  );

  if (!structuralChangeRequested) {
    return;
  }

  const hasActiveDraftExceptions =
    roster.exceptions.some(
      (exception) => exception.status === "ACTIVE",
    );

  if (!hasActiveDraftExceptions) {
    return;
  }

  throw new WorkScheduleStateError(
    "Structural Monthly Roster fields cannot be changed while active draft exceptions exist; remove active exceptions before changing rosterMonth, departmentOrgUnitId, workPatternId, or holidayCalendarId",
  );
}

function buildRosterExceptionRecord(params: {
  readonly input: NormalizedRosterExceptionCommand;
  readonly monthlyRosterId: string;
  readonly pattern: WorkPatternRecord;
  readonly now: number;
}): RosterExceptionRecord {
  const endLocalTime = deriveExceptionEndLocalTime(
    params.input,
    params.pattern,
  );

  return {
    rosterExceptionId: crypto.randomUUID(),
    monthlyRosterId: params.monthlyRosterId,
    exceptionType: params.input.exceptionType,
    exceptionDate: params.input.exceptionDate,
    subjectEmploymentProfileId:
      params.input.subjectEmploymentProfileId,
    status: "ACTIVE",
    title: params.input.title,
    startLocalTime: params.input.startLocalTime,
    endLocalTime,
    workingMinutes: params.input.workingMinutes,
    breakMinutes: params.input.breakMinutes,
    studioResourceIds: [
      ...params.input.studioResourceIds,
    ],
    reason: params.input.reason,
    sourceNote: params.input.sourceNote,
    description: params.input.description,
    externalRef: params.input.externalRef,
    removedAt: null,
    createdAt: params.now,
    updatedAt: params.now,
  };
}

function buildRosterExceptionPatch(params: {
  readonly existing: RosterExceptionRecord;
  readonly input: NormalizedRosterExceptionCommand;
  readonly pattern: WorkPatternRecord;
  readonly now: number;
}): UpdateRosterExceptionInput {
  const endLocalTime = deriveExceptionEndLocalTime(
    params.input,
    params.pattern,
  );
  const patch: {
    monthlyRosterId: string;
    rosterExceptionId: string;
    updatedAt: number;
    exceptionType?: RosterExceptionType;
    exceptionDate?: string;
    subjectEmploymentProfileId?: string;
    title?: string | null;
    startLocalTime?: string | null;
    endLocalTime?: string | null;
    workingMinutes?: number | null;
    breakMinutes?: number | null;
    studioResourceIds?: readonly string[];
    reason?: string | null;
    sourceNote?: string | null;
    description?: string | null;
    externalRef?: string | null;
  } = {
    monthlyRosterId: params.input.monthlyRosterId,
    rosterExceptionId:
      params.input.rosterExceptionId as string,
    updatedAt: params.now,
  };

  for (const [field, value] of Object.entries({
    exceptionType: params.input.exceptionType,
    exceptionDate: params.input.exceptionDate,
    subjectEmploymentProfileId:
      params.input.subjectEmploymentProfileId,
    title: params.input.title,
    startLocalTime: params.input.startLocalTime,
    endLocalTime,
    workingMinutes: params.input.workingMinutes,
    breakMinutes: params.input.breakMinutes,
    studioResourceIds: [
      ...params.input.studioResourceIds,
    ],
    reason: params.input.reason,
    sourceNote: params.input.sourceNote,
    description: params.input.description,
    externalRef: params.input.externalRef,
  })) {
    const current = (
      params.existing as unknown as Record<
        string,
        unknown
      >
    )[field];

    if (
      Array.isArray(value) &&
      Array.isArray(current)
    ) {
      if (!areStringArraysEqual(value, current)) {
        (
          patch as unknown as Record<
            string,
            unknown
          >
        )[field] = value;
      }
      continue;
    }

    if (value !== current) {
      (
        patch as unknown as Record<string, unknown>
      )[field] = value;
    }
  }

  return patch;
}

function summarizeRosterExceptionPatch(
  patch: UpdateRosterExceptionInput,
): readonly string[] {
  return Object.keys(patch).filter(
    (field) =>
      ![
        "monthlyRosterId",
        "rosterExceptionId",
        "updatedAt",
      ].includes(field),
  );
}

function deriveExceptionEndLocalTime(
  input: NormalizedRosterExceptionCommand,
  pattern: WorkPatternRecord,
): string | null {
  if (input.exceptionType === "WORKING_TO_OFF") {
    return null;
  }

  if (input.exceptionType === "CHANGE_TIME") {
    return calculateEndLocalTime({
      startLocalTime: input.startLocalTime as string,
      workingMinutes: pattern.workingMinutes,
      breakMinutes: pattern.breakMinutes,
    });
  }

  return calculateEndLocalTime({
    startLocalTime: input.startLocalTime as string,
    workingMinutes: input.workingMinutes as number,
    breakMinutes: input.breakMinutes as number,
  });
}

function assertDraftRoster(
  roster: MonthlyRosterRecord,
): void {
  if (roster.status === "DRAFT") {
    return;
  }

  throw new WorkScheduleStateError(
    `Monthly Roster mutation requires status DRAFT, received ${roster.status}`,
  );
}

function assertRosterPublishBaseState(
  roster: MonthlyRosterRecord,
): void {
  if (roster.archivedAt !== null) {
    throw new WorkScheduleStateError(
      "Archived Monthly Rosters cannot be published",
    );
  }

  if (roster.timezone !== MONTHLY_ROSTER_TIMEZONE) {
    throw new WorkScheduleValidationError(
      `Monthly Roster timezone must be ${MONTHLY_ROSTER_TIMEZONE}`,
    );
  }

  normalizeRosterMonth(roster.rosterMonth);

  if (
    roster.targetSubjectKind !==
    MONTHLY_ROSTER_TARGET_SUBJECT_KIND
  ) {
    throw new WorkScheduleValidationError(
      "Monthly Roster publish supports only EMPLOYMENT_PROFILE targets in MVP-A",
    );
  }

  if (
    roster.targetOrgUnitMode !==
    MONTHLY_ROSTER_TARGET_ORG_UNIT_MODE
  ) {
    throw new WorkScheduleValidationError(
      "Monthly Roster publish supports only EXACT_ONLY department targets in MVP-A",
    );
  }
}

function assertPreviewCanPublish(preview: {
  readonly rows: readonly MonthlyRosterPreviewRowView[];
  readonly summary: { readonly totalConflicts: number };
}): void {
  const blockerCount = preview.rows.reduce(
    (total, row) => total + row.blockers.length,
    0,
  );

  if (
    preview.summary.totalConflicts > 0 ||
    blockerCount > 0
  ) {
    throw new WorkScheduleOverlapConflictError(
      "Monthly Roster publish is blocked because current preview has blockers or conflicts",
    );
  }
}

function buildGenerationRunId(
  monthlyRosterId: string,
  input: NormalizedPublishMonthlyRosterCommand,
): string {
  if (!input.idempotencyKey) {
    return crypto.randomUUID();
  }

  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        monthlyRosterId,
        idempotencyKey: input.idempotencyKey,
      }),
    )
    .digest("hex");
}

function buildPublishSummary(params: {
  readonly roster: MonthlyRosterRecord;
  readonly generatedWorkShiftIds: readonly string[];
  readonly generatedWorkShiftCount: number;
  readonly skippedWorkingToOffCount: number;
  readonly holidaySuppressedCount: number;
  readonly changeTimeCount: number;
  readonly addSpecialShiftCount: number;
  readonly conflictCount: number;
  readonly computedPreviewHash: string | null;
}): PublishMonthlyRosterResult {
  return {
    monthlyRosterId: params.roster.monthlyRosterId,
    status: params.roster.status,
    sourceGenerationRunId:
      params.roster.publishGenerationRunId,
    publishedAt: params.roster.publishedAt,
    publishedByUserId:
      params.roster.publishedByUserId,
    generatedWorkShiftCount:
      params.generatedWorkShiftCount,
    skippedWorkingToOffCount:
      params.skippedWorkingToOffCount,
    holidaySuppressedCount:
      params.holidaySuppressedCount,
    changeTimeCount: params.changeTimeCount,
    addSpecialShiftCount:
      params.addSpecialShiftCount,
    conflictCount: params.conflictCount,
    computedPreviewHash:
      params.computedPreviewHash,
    generatedWorkShiftIds: [
      ...params.generatedWorkShiftIds,
    ],
  };
}

function requireActiveException(
  roster: MonthlyRosterRecord,
  rosterExceptionId: string,
): RosterExceptionRecord {
  const exception = roster.exceptions.find(
    (candidate) =>
      candidate.rosterExceptionId ===
      rosterExceptionId,
  );

  if (!exception) {
    throw new WorkScheduleNotFoundError(
      rosterExceptionId,
    );
  }

  if (exception.status !== "ACTIVE") {
    throw new WorkScheduleStateError(
      "Only ACTIVE roster exceptions can be mutated",
    );
  }

  return exception;
}

function assertNoContradictoryStandardException(
  roster: MonthlyRosterRecord,
  input: NormalizedRosterExceptionCommand,
): void {
  if (input.exceptionType === "ADD_SPECIAL_SHIFT") {
    return;
  }

  const duplicate = roster.exceptions.some(
    (exception) =>
      exception.status === "ACTIVE" &&
      exception.rosterExceptionId !==
        input.rosterExceptionId &&
      exception.subjectEmploymentProfileId ===
        input.subjectEmploymentProfileId &&
      exception.exceptionDate ===
        input.exceptionDate &&
      exception.exceptionType !==
        "ADD_SPECIAL_SHIFT",
  );

  if (duplicate) {
    throw new WorkScheduleConflictError(
      "Only one ACTIVE standard-candidate exception is allowed for a profile/date",
    );
  }
}

function assertStandardRosterCandidate(params: {
  readonly date: string;
  readonly pattern: WorkPatternRecord;
  readonly calendar: {
    readonly entries: readonly {
      readonly date: string;
      readonly status: string;
    }[];
  };
}): void {
  const weekday = weekdayTokenForDate(params.date);

  if (!params.pattern.workingDays.includes(weekday)) {
    throw new WorkScheduleValidationError(
      "Roster exception must target a Work Pattern working day",
    );
  }

  const activeHoliday = params.calendar.entries.some(
    (entry) =>
      entry.status === "ACTIVE" &&
      entry.date === params.date,
  );

  if (activeHoliday) {
    throw new WorkScheduleValidationError(
      "Roster exception cannot target a calendar holiday/off-day standard candidate",
    );
  }
}

function assertDateWithinRosterMonth(
  date: string,
  rosterMonth: string,
): void {
  assertWorkScheduleDateOnlyWithinRosterMonth(
    date,
    rosterMonth,
    {
      field: "exceptionDate",
      outsideMonthMessage:
        "exceptionDate must be inside rosterMonth",
    },
  );
}

function normalizeRosterMonth(value: unknown): string {
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      "rosterMonth must be a YYYY-MM string",
    );
  }

  const normalized = value.trim();
  const match = /^(\d{4})-(\d{2})$/u.exec(
    normalized,
  );

  if (!match) {
    throw new WorkScheduleValidationError(
      "rosterMonth must be a YYYY-MM string",
    );
  }

  const month = Number(match[2]);

  if (month < 1 || month > 12) {
    throw new WorkScheduleValidationError(
      "rosterMonth must contain a real calendar month",
    );
  }

  return normalized;
}

function normalizeDateOnly(
  value: unknown,
  field: string,
): string {
  return normalizeWorkScheduleDateOnly(value, field);
}

function normalizeRosterTimezone(
  value: unknown,
): typeof MONTHLY_ROSTER_TIMEZONE {
  if (value === undefined || value === null) {
    return MONTHLY_ROSTER_TIMEZONE;
  }

  if (value !== MONTHLY_ROSTER_TIMEZONE) {
    throw new WorkScheduleValidationError(
      `timezone must be ${MONTHLY_ROSTER_TIMEZONE}`,
    );
  }

  return MONTHLY_ROSTER_TIMEZONE;
}

function normalizeExceptionType(
  value: unknown,
): RosterExceptionType {
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `exceptionType must be one of ${ROSTER_EXCEPTION_TYPES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    ROSTER_EXCEPTION_TYPES.includes(
      normalized as RosterExceptionType,
    )
  ) {
    return normalized as RosterExceptionType;
  }

  throw new WorkScheduleValidationError(
    `exceptionType must be one of ${ROSTER_EXCEPTION_TYPES.join(", ")}`,
  );
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

  if (
    !/^([01]\d|2[0-3]):([0-5]\d)$/u.test(
      normalized,
    )
  ) {
    throw new WorkScheduleValidationError(
      `${field} must be a valid HH:mm 24-hour local time`,
    );
  }

  return normalized;
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

function normalizeStudioResourceIds(
  value: unknown,
): readonly string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new WorkScheduleValidationError(
      "studioResourceIds must be an array",
    );
  }

  const ids = value.map((item, index) =>
    normalizeRequiredText(
      item,
      `studioResourceIds[${index}]`,
    ),
  );
  const distinct = new Set(ids);

  if (distinct.size !== ids.length) {
    throw new WorkScheduleValidationError(
      "studioResourceIds must not contain duplicate values",
    );
  }

  return [...distinct].sort();
}

function parseRequestedScope(
  value: unknown,
): "global" | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new WorkSchedulePermissionScopeError(
      "Admin Monthly Roster operations require workSchedule.global scope",
    );
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "global") {
    return "global";
  }

  throw new WorkSchedulePermissionScopeError(
    "Admin Monthly Roster operations require workSchedule.global scope",
  );
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
      "Roster exception window must end within the same local calendar date; overnight windows are not supported in MVP-A",
    );
  }

  return formatLocalTimeMinutes(total);
}

function parseLocalTimeMinutes(value: string): number {
  const [hourText, minuteText] = value.split(":");
  return Number(hourText) * 60 + Number(minuteText);
}

function formatLocalTimeMinutes(value: number): string {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function weekdayTokenForDate(
  date: string,
): WorkPatternWeekdayToken {
  const [year, month, day] = date
    .split("-")
    .map(Number);
  const parsed = new Date(
    Date.UTC(year, month - 1, day),
  );
  const tokens: readonly WorkPatternWeekdayToken[] =
    ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

  return tokens[parsed.getUTCDay()];
}

function toVietnamLocalUtcMillis(
  date: string,
  time: string,
): number {
  const [year, month, day] = date
    .split("-")
    .map(Number);
  const [hour, minute] = time.split(":").map(Number);

  return Date.UTC(
    year,
    month - 1,
    day,
    hour - 7,
    minute,
  );
}

function areStringArraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function canonicalizeSearchToken(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function toUtcShiftCodeDateBucket(
  timestamp: number,
): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(
    2,
    "0",
  );
  const day = String(date.getUTCDate()).padStart(
    2,
    "0",
  );

  return `${year}${month}${day}`;
}

function formatGeneratedShiftCode(
  dateBucket: string,
  sequence: number,
): string {
  return `WS-${dateBucket}-${String(sequence).padStart(4, "0")}`;
}

function toRosterMonthCodeBucket(
  rosterMonth: string,
): string {
  return rosterMonth.replace("-", "");
}

function formatGeneratedRosterCode(
  monthBucket: string,
  sequence: number,
): string {
  return `MR-${monthBucket}-${String(sequence).padStart(6, "0")}`;
}

function assertAdminActorType(actor: Actor): void {
  if (actor.type === "admin") {
    return;
  }

  throw new SystemInvariantError(
    "PERMISSION_DENIED",
    `Monthly Roster access requires actor.type admin, received ${actor.type}`,
  );
}

function toMonthlyRosterMutationView(
  record: MonthlyRosterRecord,
): MonthlyRosterMutationView {
  return {
    monthlyRosterId: record.monthlyRosterId,
    rosterCode: record.rosterCode,
    rosterMonth: record.rosterMonth,
    timezone: record.timezone,
    targetSubjectKind: record.targetSubjectKind,
    targetOrgUnitMode: record.targetOrgUnitMode,
    departmentOrgUnitId: record.departmentOrgUnitId,
    workPatternId: record.workPatternId,
    holidayCalendarId: record.holidayCalendarId,
    status: record.status,
    draftVersion: record.draftVersion,
    exceptionCount: record.exceptions.filter(
      (exception) => exception.status === "ACTIVE",
    ).length,
    previewHash: record.previewHash,
    lastPreviewedAt: record.lastPreviewedAt,
    publishedAt: record.publishedAt,
    publishedByUserId: record.publishedByUserId,
    publishGenerationRunId:
      record.publishGenerationRunId,
    description: record.description,
    externalRef: record.externalRef,
    exceptions: record.exceptions.map((exception) => ({
      ...exception,
      studioResourceIds: [
        ...exception.studioResourceIds,
      ],
    })),
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

function classifyMonthlyRosterMutationFailure(
  error: unknown,
): MonthlyRosterFailureClassification {
  if (error instanceof WorkScheduleValidationError) {
    return "validation";
  }

  if (error instanceof WorkScheduleConflictError) {
    return "conflict";
  }

  if (error instanceof WorkScheduleNotFoundError) {
    return "not_found";
  }

  if (error instanceof WorkScheduleStateError) {
    return "state_error";
  }

  if (
    error instanceof
    WorkScheduleInvalidSubjectReferenceError
  ) {
    return "invalid_subject_reference";
  }

  if (
    error instanceof
    WorkScheduleInvalidResourceReferenceError
  ) {
    return "invalid_resource_reference";
  }

  if (error instanceof WorkScheduleOverlapConflictError) {
    return "overlap_conflict";
  }

  if (error instanceof WorkSchedulePermissionScopeError) {
    return "permission_scope";
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

function truncateLogMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : String(error);

  if (raw.length <= 256) {
    return raw;
  }

  return `${raw.slice(0, 253)}...`;
}
