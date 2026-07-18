import crypto from "crypto";
import { ClientSession, MongoServerError } from "mongodb";
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
import {
  createRosterSourceSnapshot,
  WorkScheduleRosterMembershipTrace,
} from "@modules/work-schedule/domain/work-schedule-application-policy";
import {
  WorkScheduleEmploymentProfileReadonlyAccess,
  WorkScheduleReferencedEmploymentProfile,
} from "@modules/work-schedule/domain/work-schedule-employment-profile-readonly-access";
import { WorkScheduleOrgUnitReadonlyAccess } from "@modules/work-schedule/domain/work-schedule-org-unit-readonly-access";
import { WorkScheduleStudioResourceReadonlyAccess } from "@modules/work-schedule/domain/work-schedule-studio-resource-readonly-access";
import { WorkScheduleTalentGroupReadonlyAccess } from "@modules/work-schedule/domain/work-schedule-talent-group-readonly-access";
import { requireAdminObjectScopeAuthority } from "@modules/role/domain/admin-object-scope-authority";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";
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
import { assertWorkScheduleMakerCheckerSeparation } from "@modules/work-schedule/domain/work-schedule-maker-checker";
import { WorkScheduleAvailabilityBatchRepository } from "@modules/work-schedule/domain/work-schedule-availability.repository";
import {
  WorkScheduleAvailabilityBatchRecord,
  WorkScheduleAvailabilityLineRecord,
} from "@modules/work-schedule/domain/work-schedule-availability.types";
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
  HolidayCalendarRecord,
  MONTHLY_ROSTER_TARGET_ORG_UNIT_MODE,
  MONTHLY_ROSTER_TARGET_MODES,
  MONTHLY_ROSTER_TARGET_SUBJECT_KIND,
  MONTHLY_ROSTER_TARGET_TYPES,
  MONTHLY_ROSTER_TIMEZONE,
  ROSTER_EXCEPTION_TYPES,
  MonthlyRosterMemberExclusionReasonCode,
  MonthlyRosterMutationView,
  MonthlyRosterPreviewExcludedMemberView,
  MonthlyRosterPreviewRowView,
  MonthlyRosterRecord,
  MonthlyRosterTargetMode,
  MonthlyRosterTargetType,
  RosterExceptionRecord,
  RosterExceptionType,
  WorkPatternRecord,
  WorkPatternWeekdayToken,
  WorkShiftRecord,
  WorkShiftScope,
} from "@modules/work-schedule/domain/work-schedule.types";
import {
  AddRosterExceptionCommand,
  ApplyAvailabilityLineResult,
  ApplyAvailabilityLinesToMonthlyRosterCommand,
  ApplyAvailabilityLinesToMonthlyRosterResult,
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
  readonly targetType: MonthlyRosterTargetType;
  readonly targetMode: MonthlyRosterTargetMode;
  readonly targetOrgUnitId: string | null;
  readonly targetTalentGroupId: string | null;
  readonly departmentOrgUnitId: string | null;
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
  readonly targetType?: MonthlyRosterTargetType;
  readonly targetMode?: MonthlyRosterTargetMode;
  readonly targetOrgUnitId?: string | null;
  readonly targetTalentGroupId?: string | null;
  readonly departmentOrgUnitId?: string | null;
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

interface NormalizedApplyAvailabilityLinesCommand {
  readonly monthlyRosterId: string;
  readonly availabilityLineIds: readonly string[];
  readonly applyNote: string | null;
  readonly expectedRosterVersion?: number;
  readonly expectedRequestVersions: Readonly<Record<string, number>>;
  readonly idempotencyKey: string | null;
  readonly requestedScope?: WorkShiftScope;
}

interface AvailabilityExceptionDraft {
  readonly exceptionDate: string;
  readonly exceptionType: "WORKING_TO_OFF" | "CHANGE_TIME";
  readonly startLocalTime: string | null;
  readonly endLocalTime: string | null;
}

interface AvailabilityMakerCheckerPreflight {
  readonly lines: readonly WorkScheduleAvailabilityLineRecord[];
  readonly lineById: ReadonlyMap<string, WorkScheduleAvailabilityLineRecord>;
  readonly batchById: ReadonlyMap<string, WorkScheduleAvailabilityBatchRecord>;
}

interface NormalizedMonthlyRosterTarget {
  readonly targetType: MonthlyRosterTargetType;
  readonly targetMode: MonthlyRosterTargetMode;
  readonly targetOrgUnitId: string | null;
  readonly targetTalentGroupId: string | null;
  readonly departmentOrgUnitId: string | null;
}

interface ResolvedRosterMembers {
  readonly eligibleProfiles: readonly WorkScheduleReferencedEmploymentProfile[];
  readonly excludedMembers: readonly MonthlyRosterPreviewExcludedMemberView[];
  readonly membershipTrace: readonly WorkScheduleRosterMembershipTrace[];
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
    private readonly talentGroupReadonlyAccess: WorkScheduleTalentGroupReadonlyAccess = createMissingTalentGroupReadonlyAccess(),
    private readonly logger: StructuredLogger = createStructuredLogger(),
    private readonly now: () => number = Date.now,
    private readonly availabilityRepository: WorkScheduleAvailabilityBatchRepository = createMissingAvailabilityRepository(),
    private readonly structuredAuthority: StructuredScopeAuthorityService = createMissingStructuredAuthority(),
  ) {}

  async createMonthlyRosterDraft(
    actor: Actor,
    command: CreateMonthlyRosterDraftCommand,
  ): Promise<MonthlyRosterMutationResult> {
    const operation = "work-schedule.monthly-roster.create-draft";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_CREATE,
    );
    const input = normalizeCreateMonthlyRosterDraftCommand(command);
    assertRosterMonthWithinPlanningWindow(input.rosterMonth, this.now());

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        rosterCode: input.rosterCode ?? null,
        rosterMonth: input.rosterMonth,
        targetType: input.targetType,
        targetMode: input.targetMode,
        targetId: getRosterTargetId(input),
      },
      async (session) => {
        await this.assertActiveRosterTarget(input, session);
        const scope = await this.requireStructuredAuthorityForRosterTarget(
          actor,
          Permission.WORK_SCHEDULE_CREATE,
          input,
          input.requestedScope,
        );
        await this.requireActivePattern(input.workPatternId, session);
        await this.requireActiveCalendar(input.holidayCalendarId, session);
        if (input.rosterCode !== undefined) {
          await this.assertNoDuplicateRosterCode(input.rosterCode, session);
        }
        await this.assertNoDuplicateActiveRoster(
          input,
          input.rosterMonth,
          session,
        );

        const now = this.now();
        let created!: MonthlyRosterRecord;
        const maxCreateAttempts = input.rosterCode === undefined ? 5 : 1;

        for (let attempt = 1; attempt <= maxCreateAttempts; attempt += 1) {
          const rosterCode =
            input.rosterCode ??
            (await this.allocateGeneratedRosterCode(
              input.rosterMonth,
              session,
            ));
          const record: MonthlyRosterRecord = {
            monthlyRosterId: crypto.randomUUID(),
            rosterCode,
            normalizedRosterCode: canonicalizeSearchToken(rosterCode),
            rosterMonth: input.rosterMonth,
            timezone: input.timezone,
            targetSubjectKind: MONTHLY_ROSTER_TARGET_SUBJECT_KIND,
            targetOrgUnitMode: MONTHLY_ROSTER_TARGET_ORG_UNIT_MODE,
            targetType: input.targetType,
            targetMode: input.targetMode,
            targetOrgUnitId: input.targetOrgUnitId,
            targetTalentGroupId: input.targetTalentGroupId,
            departmentOrgUnitId: input.departmentOrgUnitId,
            workPatternId: input.workPatternId,
            holidayCalendarId: input.holidayCalendarId,
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
            created = await this.rosterRepository.insert(record, session);
            break;
          } catch (error) {
            if (!isDuplicateKeyError(error)) {
              throw error;
            }

            if (input.rosterCode !== undefined) {
              const existing = await this.rosterRepository.findByRosterCode(
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
              input,
              input.rosterMonth,
              session,
            );
          }
        }

        await this.recordAudit({
          actor,
          permission,
          monthlyRosterId: created.monthlyRosterId,
          mutationType: operation,
          metadata: {
            rosterCode: created.rosterCode,
            rosterMonth: created.rosterMonth,
            departmentOrgUnitId: created.departmentOrgUnitId,
            targetType: created.targetType,
            targetMode: created.targetMode,
            targetId: getRosterTargetId(created),
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
    const operation = "work-schedule.monthly-roster.update-draft";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_UPDATE,
    );
    const input = normalizeUpdateMonthlyRosterDraftCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      { monthlyRosterId: input.monthlyRosterId },
      async (session, controls) => {
        const current = await this.requireMonthlyRoster(
          input.monthlyRosterId,
          session,
        );

        await this.requireStructuredAuthorityForRosterTarget(
          actor,
          Permission.WORK_SCHEDULE_UPDATE,
          current,
          input.requestedScope,
        );
        assertDraftRoster(current);
        const candidateTarget = mergeRosterTarget(current, input);
        const candidateRosterMonth = input.rosterMonth ?? current.rosterMonth;
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
          input.workPatternId ?? current.workPatternId;
        const candidateHolidayCalendarId =
          input.holidayCalendarId ?? current.holidayCalendarId;

        await this.assertActiveRosterTarget(candidateTarget, session);
        const scope = areRosterTargetsEqual(candidateTarget, current)
          ? getStructuredRosterScopeLabel(current)
          : await this.requireStructuredAuthorityForRosterTarget(
              actor,
              Permission.WORK_SCHEDULE_UPDATE,
              candidateTarget,
              input.requestedScope,
            );
        await this.requireActivePattern(candidateWorkPatternId, session);
        await this.requireActiveCalendar(candidateHolidayCalendarId, session);

        if (
          !areRosterTargetsEqual(candidateTarget, current) ||
          candidateRosterMonth !== current.rosterMonth
        ) {
          await this.assertNoDuplicateActiveRoster(
            candidateTarget,
            candidateRosterMonth,
            session,
            current.monthlyRosterId,
          );
        }

        const patch = buildMonthlyRosterDraftPatch({
          current,
          input,
        });
        const changedFields = summarizeMonthlyRosterPatch(patch);

        if (changedFields.length === 0) {
          controls.markExplicitNoOpSuccess();
          return toMonthlyRosterMutationView(current);
        }

        assertNoStructuralRosterDraftChangeWithActiveExceptions(
          current,
          changedFields,
        );

        const updated = await this.rosterRepository.updateDraft(patch, session);

        if (!updated) {
          throw new WorkScheduleConflictError(
            `Failed to update monthly roster draft: ${current.monthlyRosterId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          monthlyRosterId: updated.monthlyRosterId,
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
    const operation = "work-schedule.monthly-roster.archive";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
    );
    const input = normalizeRosterLifecycleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      { monthlyRosterId: input.monthlyRosterId },
      async (session) => {
        const current = await this.requireMonthlyRoster(
          input.monthlyRosterId,
          session,
        );

        const scope = await this.requireStructuredAuthorityForRosterTarget(
          actor,
          Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
          current,
          input.requestedScope,
        );
        if (current.status === "ARCHIVED") {
          throw new WorkScheduleStateError(
            "ARCHIVED monthly rosters cannot transition",
          );
        }

        const now = Date.now();
        const updated = await this.rosterRepository.transitionStatus(
          {
            monthlyRosterId: current.monthlyRosterId,
            fromStatuses: ["DRAFT", "PUBLISHED", "LOCKED"],
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
          monthlyRosterId: updated.monthlyRosterId,
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
    const operation = "work-schedule.monthly-roster.publish";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
    );
    const input = normalizePublishMonthlyRosterCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        monthlyRosterId: input.monthlyRosterId,
        expectedPreviewHash: input.expectedPreviewHash ?? null,
        idempotencyKey: input.idempotencyKey,
      },
      async (session, controls) => {
        const current = await this.requireMonthlyRoster(
          input.monthlyRosterId,
          session,
        );
        const scope = await this.requireStructuredAuthorityForRosterTarget(
          actor,
          Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
          current,
          input.requestedScope,
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
            generatedWorkShiftIds: existingSummary.workShiftIds,
            generatedWorkShiftCount: existingSummary.generatedWorkShiftCount,
            skippedWorkingToOffCount: current.exceptions.filter(
              (exception) =>
                exception.status === "ACTIVE" &&
                exception.exceptionType === "WORKING_TO_OFF",
            ).length,
            holidaySuppressedCount: 0,
            changeTimeCount: existingSummary.changeTimeCount,
            addSpecialShiftCount: existingSummary.addSpecialShiftCount,
            conflictCount: 0,
            computedPreviewHash: current.previewHash,
          });
        }

        assertDraftRoster(current);
        assertRosterMonthWithinPlanningWindow(current.rosterMonth, this.now());

        if (!input.expectedPreviewHash) {
          throw new WorkScheduleValidationError(
            "expectedPreviewHash is required to publish a DRAFT Monthly Roster",
          );
        }

        assertRosterPublishBaseState(current);
        await this.assertActiveRosterTarget(current, session);
        const pattern = await this.requireActivePattern(
          current.workPatternId,
          session,
        );
        const calendar = await this.requireActiveCalendar(
          current.holidayCalendarId,
          session,
        );
        const memberResolution = await this.resolveRosterMembers(
          current,
          session,
        );
        const profiles = memberResolution.eligibleProfiles;
        if (profiles.length === 0) {
          throw new WorkScheduleValidationError(
            "Monthly Roster publish requires at least one eligible active Employment Profile",
          );
        }
        const monthWindow = rosterMonthUtcWindow(current.rosterMonth);
        const activeShifts =
          await this.workShiftRepository.listActiveEmploymentProfileShiftsForWindow(
            {
              subjectEmploymentProfileIds: profiles.map(
                (profile) => profile.id,
              ),
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
          excludedMembers: memberResolution.excludedMembers,
          existingActiveShifts: activeShifts,
        });

        if (preview.computedPreviewHash !== input.expectedPreviewHash) {
          throw new WorkScheduleConflictError(
            "expectedPreviewHash does not match the current Monthly Roster preview",
          );
        }

        if (
          current.previewHash !== null &&
          current.previewHash !== preview.computedPreviewHash
        ) {
          throw new WorkScheduleConflictError(
            "Stored Monthly Roster previewHash is stale; re-preview before publish",
          );
        }

        assertPreviewCanPublish(preview);

        const publishableRows = preview.rows.filter(
          (row) => row.isCandidateShift,
        );
        const sourceGenerationRunId = buildGenerationRunId(
          current.monthlyRosterId,
          input,
        );
        const now = this.now();
        const sourceSnapshot = createRosterSourceSnapshot({
          rosterDraftVersion: current.draftVersion,
          holidayCalendarId: calendar.holidayCalendarId,
          holidayCalendarVersion: calendar.updatedAt,
          holidayEffectiveDays: calendar.entries
            .filter((entry) => entry.status === "ACTIVE")
            .map((entry) => entry.date),
          workPatternId: pattern.workPatternId,
          workPatternVersion: pattern.updatedAt,
          resolvedWorkPattern: {
            timezone: pattern.timezone,
            workingDays: pattern.workingDays,
            startLocalTime: pattern.startLocalTime,
            endLocalTime: pattern.endLocalTime,
            workingMinutes: pattern.workingMinutes,
            breakMinutes: pattern.breakMinutes,
          },
          eligibleEmploymentProfileIds: profiles.map((profile) => profile.id),
          membershipTrace: memberResolution.membershipTrace,
          previewHash: preview.computedPreviewHash,
          previewActorId: actor.id,
          previewedAt: now,
        });
        const generatedWorkShiftIds: string[] = [];

        for (const row of publishableRows) {
          await this.assertGeneratedRowInsertIsStillSafe(row, current, session);
          const record = await this.buildGeneratedWorkShiftRecord({
            roster: current,
            row,
            sourceGenerationRunId,
            now,
            session,
          });

          try {
            const created = await this.workShiftRepository.insert(
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

        const published = await this.rosterRepository.publish(
          {
            monthlyRosterId: current.monthlyRosterId,
            fromStatus: "DRAFT",
            updatedAt: now,
            publishedAt: now,
            publishedByUserId: actor.id,
            publishGenerationRunId: sourceGenerationRunId,
            previewHash: preview.computedPreviewHash,
            lastPreviewedAt: now,
            publicationVersion: (current.publicationVersion ?? 0) + 1,
            sourceSnapshot,
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
          monthlyRosterId: published.monthlyRosterId,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: published.status,
            generatedWorkShiftCount: generatedWorkShiftIds.length,
            computedPreviewHash: preview.computedPreviewHash,
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
          generatedWorkShiftCount: generatedWorkShiftIds.length,
          skippedWorkingToOffCount: preview.summary.totalWorkingToOff,
          holidaySuppressedCount: preview.summary.totalHolidaySuppressions,
          changeTimeCount: preview.summary.totalChangeTime,
          addSpecialShiftCount: preview.summary.totalAddSpecialShift,
          conflictCount: 0,
          computedPreviewHash: preview.computedPreviewHash,
        });
      },
      (result) => ({
        monthlyRosterId: result.monthlyRosterId,
        status: result.status,
        generatedWorkShiftCount: result.generatedWorkShiftCount,
      }),
    );
  }

  async applyAvailabilityLinesToMonthlyRoster(
    actor: Actor,
    command: ApplyAvailabilityLinesToMonthlyRosterCommand,
  ): Promise<ApplyAvailabilityLinesToMonthlyRosterResult> {
    const operation = "work-schedule.monthly-roster.apply-availability-lines";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_UPDATE,
    );
    const input = normalizeApplyAvailabilityLinesCommand(command);
    await this.preflightAvailabilityMakerChecker(
      actor,
      input.availabilityLineIds,
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        monthlyRosterId: input.monthlyRosterId,
        availabilityLineCount: input.availabilityLineIds.length,
        expectedRosterVersion: input.expectedRosterVersion ?? null,
        expectedRequestVersions: input.expectedRequestVersions,
        idempotencyKey: input.idempotencyKey,
      },
      async (session) => {
        const makerCheckerPreflight =
          await this.preflightAvailabilityMakerChecker(
            actor,
            input.availabilityLineIds,
            session,
          );
        let roster = await this.requireMonthlyRoster(
          input.monthlyRosterId,
          session,
        );
        if (
          input.expectedRosterVersion !== undefined &&
          roster.draftVersion !== input.expectedRosterVersion
        ) {
          throw new WorkScheduleConflictError(
            "SOURCE_CHANGED: stale Monthly Roster draft version",
          );
        }
        const beforeSnapshot = {
          draftVersion: roster.draftVersion,
          activeRosterExceptionIds: roster.exceptions
            .filter((exception) => exception.status === "ACTIVE")
            .map((exception) => exception.rosterExceptionId),
        };
        const scope = await this.requireStructuredAuthorityForRosterTarget(
          actor,
          Permission.WORK_SCHEDULE_UPDATE,
          roster,
          input.requestedScope,
        );
        assertDraftRoster(roster);
        await this.assertActiveRosterTarget(roster, session);
        const pattern = await this.requireActivePattern(
          roster.workPatternId,
          session,
        );
        const calendar = await this.requireActiveCalendar(
          roster.holidayCalendarId,
          session,
        );
        const members = await this.resolveRosterMembers(roster, session);
        const eligibleProfileIds = new Set(
          members.eligibleProfiles.map((profile) => profile.id),
        );
        const lineById = makerCheckerPreflight.lineById;
        const batchById = makerCheckerPreflight.batchById;
        const results: ApplyAvailabilityLineResult[] = [];
        const requestVersions: Record<string, number> = {};
        const touchedBatchIds = new Set<string>();
        const now = this.now();

        for (const availabilityLineId of input.availabilityLineIds) {
          const line = lineById.get(availabilityLineId);
          if (!line) {
            results.push({
              availabilityLineId,
              outcome: "FAILED",
              rosterExceptionId: null,
              rosterExceptionIds: [],
              reason: "Availability line was not found",
            });
            continue;
          }

          const expectedRequestVersion = input.expectedRequestVersions[line.id];
          if (
            expectedRequestVersion !== undefined &&
            expectedRequestVersion !== line.updatedAt
          ) {
            throw new WorkScheduleConflictError(
              `SOURCE_CHANGED: stale availability request version for ${line.id}`,
            );
          }
          requestVersions[line.id] = line.updatedAt;
          touchedBatchIds.add(line.batchId);

          const wasPending = line.status === "PENDING";
          let effectiveLine = line;
          if (wasPending) {
            const approved =
              await this.availabilityRepository.transitionLineStatus(
                {
                  batchId: line.batchId,
                  lineId: line.id,
                  fromStatus: "PENDING",
                  toStatus: "APPROVED",
                  updatedAt: now,
                  adminDecisionNote: input.applyNote,
                  approvedAt: now,
                  approvedByActorId: actor.id,
                },
                session,
              );
            if (!approved) {
              throw new WorkScheduleConflictError(
                `APPLICATION_CONFLICT: availability line ${line.id} changed concurrently`,
              );
            }
            effectiveLine = approved;
          } else if (line.status !== "APPROVED") {
            throw new WorkScheduleStateError(
              `Availability line ${line.id} cannot be applied from ${line.status}`,
            );
          }

          const batch = batchById.get(line.batchId) ?? null;

          const prepared = prepareAvailabilityApplyLine({
            line: effectiveLine,
            batch,
            roster,
            pattern,
            calendar,
            eligibleProfileIds,
            applyNote: input.applyNote,
          });

          if (prepared.outcome !== "READY") {
            if (wasPending) {
              throw new WorkScheduleConflictError(
                `APPLICATION_CONFLICT: ${prepared.reason}`,
              );
            }
            if (prepared.outcome === "ADVISORY_ONLY") {
              await this.availabilityRepository.updateLineApplyState(
                {
                  batchId: line.batchId,
                  lineId: line.id,
                  fromApplyStatuses: ["ADVISORY_ONLY", "NOT_APPLIED"],
                  applyStatus: "ADVISORY_ONLY",
                  appliedRosterId: null,
                  appliedRosterExceptionId: null,
                  appliedRosterExceptionIds: [],
                  appliedAt: null,
                  appliedByActorId: null,
                  updatedAt: now,
                },
                session,
              );
              results.push({
                availabilityLineId: line.id,
                outcome: "ADVISORY_ONLY",
                rosterExceptionId: null,
                rosterExceptionIds: [],
                reason: prepared.reason,
                finalState: "APPLICATION_CONFLICT",
              });
              continue;
            }

            results.push({
              availabilityLineId: line.id,
              outcome: "FAILED",
              rosterExceptionId: null,
              rosterExceptionIds: [],
              reason: prepared.reason,
              finalState: "APPLICATION_FAILED",
            });
            continue;
          }

          const existingSourceExceptions =
            findActiveAvailabilitySourceExceptions(roster, line.id);
          if (existingSourceExceptions.length > 0) {
            const exceptionIds = existingSourceExceptions.map(
              (exception) => exception.rosterExceptionId,
            );
            await this.availabilityRepository.updateLineApplyState(
              {
                batchId: line.batchId,
                lineId: line.id,
                fromApplyStatuses: ["NOT_APPLIED", "ADVISORY_ONLY", "APPLIED"],
                applyStatus: "APPLIED",
                appliedRosterId: roster.monthlyRosterId,
                appliedRosterExceptionId: exceptionIds[0] ?? null,
                appliedRosterExceptionIds: exceptionIds,
                appliedAt: line.appliedAt ?? now,
                appliedByActorId: line.appliedByActorId ?? actor.id,
                updatedAt: now,
              },
              session,
            );
            results.push({
              availabilityLineId: line.id,
              outcome: "SKIPPED_ALREADY_APPLIED",
              rosterExceptionId: exceptionIds[0] ?? null,
              rosterExceptionIds: exceptionIds,
              reason:
                "Availability line was already applied to this Monthly Roster",
              finalState: "APPROVED_APPLIED",
            });
            continue;
          }

          const conflict = prepared.exceptions.find((draft) =>
            hasActiveStandardExceptionForDate(
              roster,
              line.memberEmploymentProfileId,
              draft.exceptionDate,
            ),
          );
          if (conflict) {
            if (wasPending) {
              throw new WorkScheduleConflictError(
                "APPLICATION_CONFLICT: an ACTIVE roster exception already exists for the same member/date",
              );
            }
            results.push({
              availabilityLineId: line.id,
              outcome: "FAILED",
              rosterExceptionId: null,
              rosterExceptionIds: [],
              reason:
                "An ACTIVE roster exception already exists for the same member/date",
              finalState: "APPLICATION_CONFLICT",
            });
            continue;
          }

          const createdExceptionIds: string[] = [];
          for (const draft of prepared.exceptions) {
            const exception = buildRosterExceptionFromAvailability({
              roster,
              line,
              draft,
              applyNote: input.applyNote,
              actorId: actor.id,
              now,
            });
            const updated = await this.rosterRepository.addException(
              {
                monthlyRosterId: roster.monthlyRosterId,
                exception,
                updatedAt: now,
                expectedNoActiveSourceAvailabilityLineId: line.id,
                expectedNoActiveStandardException: {
                  subjectEmploymentProfileId: line.memberEmploymentProfileId,
                  exceptionDate: draft.exceptionDate,
                },
              },
              session,
            );

            if (!updated) {
              throw new WorkScheduleConflictError(
                "Failed to apply availability line because a conflicting roster exception was created concurrently",
              );
            }

            roster = updated;
            createdExceptionIds.push(exception.rosterExceptionId);
          }

          const updatedLine =
            await this.availabilityRepository.updateLineApplyState(
              {
                batchId: line.batchId,
                lineId: line.id,
                fromApplyStatuses: ["NOT_APPLIED", "ADVISORY_ONLY"],
                applyStatus: "APPLIED",
                appliedRosterId: roster.monthlyRosterId,
                appliedRosterExceptionId: createdExceptionIds[0] ?? null,
                appliedRosterExceptionIds: createdExceptionIds,
                appliedAt: now,
                appliedByActorId: actor.id,
                updatedAt: now,
              },
              session,
            );

          if (!updatedLine) {
            throw new WorkScheduleConflictError(
              "Failed to mark availability line as applied",
            );
          }

          results.push({
            availabilityLineId: line.id,
            outcome: "APPLIED",
            rosterExceptionId: createdExceptionIds[0] ?? null,
            rosterExceptionIds: createdExceptionIds,
            reason: "Availability line applied to Monthly Roster draft",
            finalState: "APPROVED_APPLIED",
          });
        }

        for (const batchId of touchedBatchIds) {
          await reconcileAvailabilityBatchState(
            this.availabilityRepository,
            batchId,
            now,
            session,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          monthlyRosterId: roster.monthlyRosterId,
          mutationType: operation,
          metadata: {
            availabilityLineIds: input.availabilityLineIds,
            effectiveScope: scope,
            appliedCount: results.filter(
              (result) => result.outcome === "APPLIED",
            ).length,
            failedCount: results.filter((result) => result.outcome === "FAILED")
              .length,
          },
          session,
        });

        return buildApplyAvailabilityResult(roster, results, {
          beforeSnapshot,
          requestVersions,
          auditReference: `${operation}:${roster.monthlyRosterId}:${input.idempotencyKey ?? "none"}`,
        });
      },
      (result) => ({
        monthlyRosterId: result.monthlyRosterId,
        status: result.status,
        appliedCount: result.appliedCount,
        failedCount: result.failedCount,
      }),
    );
  }

  async addRosterException(
    actor: Actor,
    command: AddRosterExceptionCommand,
  ): Promise<MonthlyRosterMutationResult> {
    const operation = "work-schedule.monthly-roster.exception.add";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_UPDATE,
    );
    const input = normalizeRosterExceptionCommand(command, false);

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
    const operation = "work-schedule.monthly-roster.exception.update";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_UPDATE,
    );
    const input = normalizeRosterExceptionCommand(command, true);

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
    const operation = "work-schedule.monthly-roster.exception.remove";
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
    const requestedScope = parseRequestedScope(command.scope);

    return this.executeMutation(
      actor,
      permission,
      operation,
      { monthlyRosterId, rosterExceptionId },
      async (session) => {
        const current = await this.requireMonthlyRoster(
          monthlyRosterId,
          session,
        );
        const scope = await this.requireStructuredAuthorityForRosterTarget(
          actor,
          Permission.WORK_SCHEDULE_UPDATE,
          current,
          requestedScope,
        );
        assertDraftRoster(current);
        const exception = requireActiveException(current, rosterExceptionId);
        const now = Date.now();
        const updated = await this.rosterRepository.removeException(
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
          monthlyRosterId: updated.monthlyRosterId,
          mutationType: operation,
          metadata: {
            rosterExceptionId,
            exceptionType: exception.exceptionType,
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
        rosterExceptionId: params.input.rosterExceptionId ?? null,
        exceptionType: params.input.exceptionType,
        exceptionDate: params.input.exceptionDate,
      },
      async (session, controls) => {
        const current = await this.requireMonthlyRoster(
          params.input.monthlyRosterId,
          session,
        );
        const scope = await this.requireStructuredAuthorityForRosterTarget(
          params.actor,
          Permission.WORK_SCHEDULE_UPDATE,
          current,
          params.input.requestedScope,
        );
        assertDraftRoster(current);
        const pattern = await this.requireActivePattern(
          current.workPatternId,
          session,
        );
        const calendar = await this.requireActiveCalendar(
          current.holidayCalendarId,
          session,
        );

        assertDateWithinRosterMonth(
          params.input.exceptionDate,
          current.rosterMonth,
        );
        await this.assertEligibleEmploymentProfile(
          params.input.subjectEmploymentProfileId,
          current,
          session,
        );
        this.assertExceptionPayloadValidForType(params.input, pattern);
        assertNoContradictoryStandardException(current, params.input);

        if (params.input.exceptionType !== "ADD_SPECIAL_SHIFT") {
          assertStandardRosterCandidate({
            date: params.input.exceptionDate,
            pattern,
            calendar,
          });
        } else {
          await this.assertSpecialShiftNoConflicts(params.input, session);
        }

        const now = Date.now();

        if (params.create) {
          const exception = buildRosterExceptionRecord({
            input: params.input,
            monthlyRosterId: current.monthlyRosterId,
            pattern,
            now,
          });
          const updated = await this.rosterRepository.addException(
            {
              monthlyRosterId: current.monthlyRosterId,
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
            monthlyRosterId: updated.monthlyRosterId,
            mutationType: params.operation,
            metadata: {
              rosterExceptionId: exception.rosterExceptionId,
              exceptionType: exception.exceptionType,
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

        if (summarizeRosterExceptionPatch(patch).length === 0) {
          controls.markExplicitNoOpSuccess();
          return toMonthlyRosterMutationView(current);
        }

        const updated = await this.rosterRepository.updateException(
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
          monthlyRosterId: updated.monthlyRosterId,
          mutationType: params.operation,
          metadata: {
            rosterExceptionId: params.input.rosterExceptionId,
            exceptionType: params.input.exceptionType,
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

    const permission = PermissionResolver.resolve(permissionCode);
    PermissionGuard.assert(actor, permission);

    return permission;
  }

  private async requireMonthlyRoster(
    monthlyRosterId: string,
    session: ClientSession,
  ): Promise<MonthlyRosterRecord> {
    const roster = await this.rosterRepository.findById(
      monthlyRosterId,
      session,
    );

    if (!roster) {
      throw new WorkScheduleNotFoundError(monthlyRosterId);
    }

    return roster;
  }

  private async assertActiveRosterTarget(
    target: NormalizedMonthlyRosterTarget,
    session: ClientSession,
  ): Promise<void> {
    if (target.targetMode !== "EXACT_ONLY") {
      throw new WorkScheduleInvalidSubjectReferenceError(
        "Monthly Roster targetMode must be EXACT_ONLY",
      );
    }

    if (target.targetType === "ORG_UNIT") {
      const targetOrgUnitId = requireRosterTargetId(
        target.targetOrgUnitId,
        "targetOrgUnitId",
      );
      const orgUnit = await this.orgUnitReadonlyAccess.findById(
        targetOrgUnitId,
        session,
      );

      if (!orgUnit) {
        throw new WorkScheduleInvalidSubjectReferenceError(
          `Roster target Org Unit does not exist: ${targetOrgUnitId}`,
        );
      }

      if (orgUnit.status !== "ACTIVE") {
        throw new WorkScheduleInvalidSubjectReferenceError(
          `Roster target Org Unit must be ACTIVE: ${targetOrgUnitId}`,
        );
      }

      return;
    }

    const targetTalentGroupId = requireRosterTargetId(
      target.targetTalentGroupId,
      "targetTalentGroupId",
    );
    const talentGroup = await this.talentGroupReadonlyAccess.findById(
      targetTalentGroupId,
      session,
    );

    if (!talentGroup) {
      throw new WorkScheduleInvalidSubjectReferenceError(
        `Roster target Talent Group does not exist: ${targetTalentGroupId}`,
      );
    }

    if (talentGroup.status !== "ACTIVE") {
      throw new WorkScheduleInvalidSubjectReferenceError(
        `Roster target Talent Group must be ACTIVE: ${targetTalentGroupId}`,
      );
    }
  }

  private async requireActivePattern(
    workPatternId: string,
    session: ClientSession,
  ): Promise<WorkPatternRecord> {
    const pattern = await this.workPatternRepository.findById(
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
    const calendar = await this.holidayCalendarRepository.findById(
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
    roster: MonthlyRosterRecord,
    session: ClientSession,
  ): Promise<void> {
    const members = await this.resolveRosterMembers(roster, session);
    const eligible = members.eligibleProfiles.some(
      (profile) => profile.id === employmentProfileId,
    );

    if (!eligible) {
      throw new WorkScheduleInvalidSubjectReferenceError(
        `Employment Profile must be an eligible active member of the exact roster target: ${employmentProfileId}`,
      );
    }
  }

  private async assertNoDuplicateRosterCode(
    rosterCode: string,
    session: ClientSession,
  ): Promise<void> {
    const existing = await this.rosterRepository.findByRosterCode(
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
    target: NormalizedMonthlyRosterTarget,
    rosterMonth: string,
    session: ClientSession,
    excludeMonthlyRosterId?: string,
  ): Promise<void> {
    const existing = await this.rosterRepository.findActiveByTargetAndMonth(
      {
        targetType: target.targetType,
        targetOrgUnitId: target.targetOrgUnitId,
        targetTalentGroupId: target.targetTalentGroupId,
      },
      rosterMonth,
      session,
    );

    if (existing && existing.monthlyRosterId !== excludeMonthlyRosterId) {
      throw new WorkScheduleConflictError(
        `A non-archived monthly roster already exists for target ${getRosterTargetId(target)} and month ${rosterMonth}`,
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
      throw new WorkScheduleValidationError("ADD_SPECIAL_SHIFT requires title");
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
      const resource = await this.studioResourceReadonlyAccess.findById(
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

    const startLocalTime = input.startLocalTime as string;
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
          subjectEmploymentProfileId: input.subjectEmploymentProfileId,
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
          studioResourceIds: input.studioResourceIds,
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
      ? (roster.exceptions.find(
          (candidate) => candidate.rosterExceptionId === row.sourceExceptionId,
        ) ?? null)
      : null;
    const studioResourceIds =
      row.rowKind === "ADD_SPECIAL_SHIFT"
        ? (exception?.studioResourceIds ?? [])
        : [];
    const subjectOverlap =
      await this.workShiftRepository.hasActiveOverlappingSubjectShift(
        {
          subjectKind: "EMPLOYMENT_PROFILE",
          subjectEmploymentProfileId: row.subjectEmploymentProfileId,
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
      ? (params.roster.exceptions.find(
          (candidate) =>
            candidate.rosterExceptionId === params.row.sourceExceptionId,
        ) ?? null)
      : null;
    const shiftCode = await this.allocateGeneratedShiftCode(
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
        : (exception?.reason ?? exception?.sourceNote ?? null);
    const externalRef =
      params.row.rowKind === "ADD_SPECIAL_SHIFT"
        ? (exception?.externalRef ?? null)
        : null;

    return {
      id: crypto.randomUUID(),
      shiftCode,
      normalizedShiftCode: canonicalizeSearchToken(shiftCode),
      title,
      normalizedTitle: canonicalizeSearchToken(title),
      subjectKind: "EMPLOYMENT_PROFILE",
      subjectEmploymentProfileId: params.row.subjectEmploymentProfileId,
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
      sourceGenerationRunId: params.sourceGenerationRunId,
      sourceRosterMonth: params.roster.rosterMonth,
      sourceDepartmentOrgUnitId: params.roster.departmentOrgUnitId,
      sourceRosterTargetType: params.roster.targetType,
      sourceRosterTargetId: getRosterTargetId(params.roster),
      sourceRosterTargetMode: params.roster.targetMode,
      sourceMemberIdentityType: MONTHLY_ROSTER_TARGET_SUBJECT_KIND,
      sourceRosterLocalDate: params.row.localDate,
      sourceRosterSlotKey: params.row.sourceRosterSlotKey,
      createdAt: params.now,
      updatedAt: params.now,
    };
  }

  private async resolveRosterMembers(
    target: NormalizedMonthlyRosterTarget,
    session: ClientSession,
  ): Promise<ResolvedRosterMembers> {
    if (target.targetType === "ORG_UNIT") {
      const targetOrgUnitId = requireRosterTargetId(
        target.targetOrgUnitId,
        "targetOrgUnitId",
      );
      const eligibleProfiles = (
        await this.employmentProfileReadonlyAccess.listByOrgUnitId(
          targetOrgUnitId,
          session,
        )
      )
        .filter(
          (
            profile,
          ): profile is WorkScheduleReferencedEmploymentProfile & {
            readonly employmentStatus: "ACTIVE";
          } =>
            profile.employmentStatus === "ACTIVE" &&
            profile.orgUnitId === targetOrgUnitId,
        )
        .sort((left, right) => left.id.localeCompare(right.id));

      return {
        eligibleProfiles,
        excludedMembers: [],
        membershipTrace: eligibleProfiles.map((profile) => ({
          membershipKind: "ORG_UNIT_ASSOCIATION",
          membershipId: null,
          talentId: null,
          employmentProfileId: profile.id,
          orgUnitId: profile.orgUnitId,
          membershipStatus: profile.employmentStatus,
          eligibility: "ELIGIBLE",
          exclusionReasonCode: null,
        })),
      };
    }

    const targetTalentGroupId = requireRosterTargetId(
      target.targetTalentGroupId,
      "targetTalentGroupId",
    );
    const resolutions =
      await this.employmentProfileReadonlyAccess.listTalentGroupMemberEmploymentProfileResolutions(
        targetTalentGroupId,
        session,
      );
    const seenEmploymentProfileIds = new Set<string>();
    const eligibleProfiles: WorkScheduleReferencedEmploymentProfile[] = [];
    const excludedMembers: MonthlyRosterPreviewExcludedMemberView[] = [];
    const membershipTrace: WorkScheduleRosterMembershipTrace[] = [];

    for (const resolution of resolutions) {
      const exclusionReason = getTalentGroupMemberExclusionReason(
        resolution,
        seenEmploymentProfileIds,
      );

      if (exclusionReason) {
        excludedMembers.push({
          memberId: resolution.memberId,
          talentId: resolution.talentId,
          linkedEmploymentProfileId: resolution.linkedEmploymentProfileId,
          linkedEmploymentProfileRef: resolution.employmentProfile?.ref ?? null,
          reasonCode: exclusionReason,
        });
        membershipTrace.push({
          membershipKind: "TALENT_GROUP_MEMBERSHIP",
          membershipId: resolution.memberId,
          talentId: resolution.talentId,
          employmentProfileId: resolution.linkedEmploymentProfileId,
          orgUnitId: resolution.employmentProfile?.orgUnitId ?? null,
          membershipStatus: resolution.membershipStatus,
          eligibility: "EXCLUDED",
          exclusionReasonCode: exclusionReason,
        });
        continue;
      }

      const employmentProfile =
        resolution.employmentProfile as WorkScheduleReferencedEmploymentProfile;
      seenEmploymentProfileIds.add(employmentProfile.id);
      eligibleProfiles.push(employmentProfile);
      membershipTrace.push({
        membershipKind: "TALENT_GROUP_MEMBERSHIP",
        membershipId: resolution.memberId,
        talentId: resolution.talentId,
        employmentProfileId: employmentProfile.id,
        orgUnitId: employmentProfile.orgUnitId,
        membershipStatus: resolution.membershipStatus,
        eligibility: "ELIGIBLE",
        exclusionReasonCode: null,
      });
    }

    return {
      eligibleProfiles: eligibleProfiles.sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
      excludedMembers,
      membershipTrace,
    };
  }

  private async allocateGeneratedShiftCode(
    shiftStartAt: number,
    session: ClientSession,
  ): Promise<string> {
    const dateBucket = toUtcShiftCodeDateBucket(shiftStartAt);
    const sequence = await this.codeSequenceRepository.allocateNext(
      dateBucket,
      session,
    );

    return formatGeneratedShiftCode(dateBucket, sequence);
  }

  private async allocateGeneratedRosterCode(
    rosterMonth: string,
    session: ClientSession,
  ): Promise<string> {
    const monthBucket = toRosterMonthCodeBucket(rosterMonth);
    const sequence =
      await this.codeSequenceRepository.allocateNextMonthlyRosterCode(
        monthBucket,
        session,
      );

    return formatGeneratedRosterCode(monthBucket, sequence);
  }

  private async requireStructuredAuthorityForRosterTarget(
    actor: Actor,
    permission: Permission,
    target: NormalizedMonthlyRosterTarget,
    requestedScope: WorkShiftScope | undefined,
  ): Promise<"managedOrgUnit" | "managedTalentGroup"> {
    if (requestedScope !== undefined && requestedScope !== "global") {
      throw new WorkSchedulePermissionScopeError(
        "Admin Monthly Roster operations require workSchedule.global scope",
      );
    }

    const scope = buildStructuredRosterScope(target);
    await requireAdminObjectScopeAuthority({
      actor,
      permission,
      scope,
      authority: this.structuredAuthority,
      error: new WorkSchedulePermissionScopeError(
        `Monthly Roster operation requires matching ${scope.scopeType} authority for target ${scope.targetId}`,
      ),
    });

    return scope.scopeType;
  }

  private async preflightAvailabilityMakerChecker(
    actor: Actor,
    availabilityLineIds: readonly string[],
    session?: ClientSession,
  ): Promise<AvailabilityMakerCheckerPreflight> {
    const lines = await this.availabilityRepository.listLinesByIds(
      availabilityLineIds,
      session,
    );
    const lineById = new Map(lines.map((line) => [line.id, line]));

    if (lineById.size !== availabilityLineIds.length) {
      assertWorkScheduleMakerCheckerSeparation(undefined, actor.id);
    }

    const batchIds = [...new Set(lines.map((line) => line.batchId))];
    const batches = await Promise.all(
      batchIds.map((batchId) =>
        this.availabilityRepository.findBatchById(batchId, session),
      ),
    );
    const batchById = new Map<string, WorkScheduleAvailabilityBatchRecord>();

    for (let index = 0; index < batchIds.length; index += 1) {
      const batch = batches[index];
      assertWorkScheduleMakerCheckerSeparation(
        batch?.submittedByActorId,
        actor.id,
      );
      batchById.set(batchIds[index]!, batch!);
    }

    return {
      lines,
      lineById,
      batchById,
    };
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
    onSuccess: (result: T) => Readonly<Record<string, unknown>>,
  ): Promise<T> {
    this.logMutationEvent(actor, operation, "mutation.start", startMetadata);

    try {
      const traceId = getTraceIdOrThrow();
      const result = await this.mutationBridge.execute(
        {
          actor,
          traceId,
          requiredPermission: permission,
          mutationIdentity: operation,
          mutationTargetDescriptor:
            buildMutationTargetDescriptor(startMetadata),
        },
        async (session, controls) => fn(session, controls),
      );

      this.logMutationEvent(actor, operation, "mutation.success", {
        ...startMetadata,
        ...onSuccess(result),
      });

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
          classification: classifyMonthlyRosterMutationFailure(error),
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

function normalizeCreateMonthlyRosterDraftCommand(
  command: CreateMonthlyRosterDraftCommand,
): NormalizedCreateMonthlyRosterDraftCommand {
  const rosterCode = normalizeOptionalCreateCode(
    command.rosterCode,
    "rosterCode",
  );
  const rosterMonth = normalizeRosterMonth(command.rosterMonth);
  const target = normalizeRosterTargetForCreate(command);

  return {
    rosterCode,
    rosterMonth,
    timezone: normalizeRosterTimezone(command.timezone),
    ...target,
    workPatternId: normalizeRequiredText(
      command.workPatternId,
      "workPatternId",
    ),
    holidayCalendarId: normalizeRequiredText(
      command.holidayCalendarId,
      "holidayCalendarId",
    ),
    description:
      normalizeOptionalNullableText(command.description, "description") ?? null,
    externalRef:
      normalizeOptionalNullableText(command.externalRef, "externalRef") ?? null,
    requestedScope: parseRequestedScope(command.scope),
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
    ...normalizeRosterTargetForUpdate(command),
    workPatternId:
      command.workPatternId === undefined
        ? undefined
        : normalizeRequiredText(command.workPatternId, "workPatternId"),
    holidayCalendarId:
      command.holidayCalendarId === undefined
        ? undefined
        : normalizeRequiredText(command.holidayCalendarId, "holidayCalendarId"),
    description: normalizeOptionalNullableText(
      command.description,
      "description",
    ),
    externalRef: normalizeOptionalNullableText(
      command.externalRef,
      "externalRef",
    ),
    requestedScope: parseRequestedScope(command.scope),
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
    requestedScope: parseRequestedScope(command.scope),
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
      normalizeOptionalNullableText(command.idempotencyKey, "idempotencyKey") ??
      null,
    note: normalizeOptionalNullableText(command.note, "note") ?? null,
    requestedScope: parseRequestedScope(command.scope),
  };
}

function normalizeRosterTargetForCreate(
  command: CreateMonthlyRosterDraftCommand,
): NormalizedMonthlyRosterTarget {
  const targetType =
    command.targetType === undefined &&
    command.departmentOrgUnitId !== undefined
      ? "ORG_UNIT"
      : normalizeRosterTargetType(command.targetType);
  const targetMode = normalizeRosterTargetMode(command.targetMode);
  const targetOrgUnitId =
    command.targetOrgUnitId === undefined &&
    command.departmentOrgUnitId !== undefined
      ? normalizeRequiredText(
          command.departmentOrgUnitId,
          "departmentOrgUnitId",
        )
      : (normalizeOptionalNullableText(
          command.targetOrgUnitId,
          "targetOrgUnitId",
        ) ?? null);
  const legacyDepartmentOrgUnitId =
    command.departmentOrgUnitId === undefined
      ? undefined
      : normalizeRequiredText(
          command.departmentOrgUnitId,
          "departmentOrgUnitId",
        );
  if (
    legacyDepartmentOrgUnitId !== undefined &&
    targetOrgUnitId !== legacyDepartmentOrgUnitId
  ) {
    throw new WorkScheduleValidationError(
      "departmentOrgUnitId must match targetOrgUnitId when both are provided",
    );
  }
  const targetTalentGroupId =
    normalizeOptionalNullableText(
      command.targetTalentGroupId,
      "targetTalentGroupId",
    ) ?? null;

  return normalizeRosterTargetShape({
    targetType,
    targetMode,
    targetOrgUnitId,
    targetTalentGroupId,
    departmentOrgUnitId: targetType === "ORG_UNIT" ? targetOrgUnitId : null,
  });
}

function normalizeRosterTargetForUpdate(
  command: UpdateMonthlyRosterDraftCommand,
): Partial<NormalizedMonthlyRosterTarget> {
  const targetType =
    command.targetType === undefined
      ? undefined
      : normalizeRosterTargetType(command.targetType);
  const targetMode =
    command.targetMode === undefined
      ? undefined
      : normalizeRosterTargetMode(command.targetMode);
  const legacyDepartmentOrgUnitId =
    command.departmentOrgUnitId === undefined
      ? undefined
      : normalizeRequiredText(
          command.departmentOrgUnitId,
          "departmentOrgUnitId",
        );
  const targetOrgUnitId =
    command.targetOrgUnitId === undefined
      ? legacyDepartmentOrgUnitId
      : normalizeOptionalNullableText(
          command.targetOrgUnitId,
          "targetOrgUnitId",
        );
  const targetTalentGroupId =
    command.targetTalentGroupId === undefined
      ? undefined
      : normalizeOptionalNullableText(
          command.targetTalentGroupId,
          "targetTalentGroupId",
        );

  if (
    legacyDepartmentOrgUnitId !== undefined &&
    targetOrgUnitId !== undefined &&
    targetOrgUnitId !== legacyDepartmentOrgUnitId
  ) {
    throw new WorkScheduleValidationError(
      "departmentOrgUnitId must match targetOrgUnitId when both are provided",
    );
  }

  return {
    ...(targetType !== undefined ? { targetType } : {}),
    ...(targetMode !== undefined ? { targetMode } : {}),
    ...(targetOrgUnitId !== undefined ? { targetOrgUnitId } : {}),
    ...(targetTalentGroupId !== undefined ? { targetTalentGroupId } : {}),
    ...(legacyDepartmentOrgUnitId !== undefined
      ? { departmentOrgUnitId: legacyDepartmentOrgUnitId }
      : {}),
  };
}

function mergeRosterTarget(
  current: NormalizedMonthlyRosterTarget,
  input: Partial<NormalizedMonthlyRosterTarget>,
): NormalizedMonthlyRosterTarget {
  const targetType = input.targetType ?? current.targetType;
  const targetMode = input.targetMode ?? current.targetMode;
  const targetOrgUnitId =
    input.targetOrgUnitId !== undefined
      ? input.targetOrgUnitId
      : current.targetOrgUnitId;
  const targetTalentGroupId =
    input.targetTalentGroupId !== undefined
      ? input.targetTalentGroupId
      : current.targetTalentGroupId;

  return normalizeRosterTargetShape({
    targetType,
    targetMode,
    targetOrgUnitId,
    targetTalentGroupId,
    departmentOrgUnitId: targetType === "ORG_UNIT" ? targetOrgUnitId : null,
  });
}

function normalizeRosterTargetShape(
  target: NormalizedMonthlyRosterTarget,
): NormalizedMonthlyRosterTarget {
  if (target.targetMode !== "EXACT_ONLY") {
    throw new WorkScheduleValidationError("targetMode must be EXACT_ONLY");
  }

  if (target.targetType === "ORG_UNIT") {
    if (
      target.targetOrgUnitId === null ||
      target.targetTalentGroupId !== null
    ) {
      throw new WorkScheduleValidationError(
        "ORG_UNIT Monthly Roster targets require targetOrgUnitId and must not include targetTalentGroupId",
      );
    }

    return {
      targetType: "ORG_UNIT",
      targetMode: "EXACT_ONLY",
      targetOrgUnitId: target.targetOrgUnitId,
      targetTalentGroupId: null,
      departmentOrgUnitId: target.targetOrgUnitId,
    };
  }

  if (target.targetTalentGroupId === null || target.targetOrgUnitId !== null) {
    throw new WorkScheduleValidationError(
      "TALENT_GROUP Monthly Roster targets require targetTalentGroupId and must not include targetOrgUnitId",
    );
  }

  return {
    targetType: "TALENT_GROUP",
    targetMode: "EXACT_ONLY",
    targetOrgUnitId: null,
    targetTalentGroupId: target.targetTalentGroupId,
    departmentOrgUnitId: null,
  };
}

function normalizeRosterTargetType(value: unknown): MonthlyRosterTargetType {
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `targetType must be one of ${MONTHLY_ROSTER_TARGET_TYPES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    MONTHLY_ROSTER_TARGET_TYPES.includes(normalized as MonthlyRosterTargetType)
  ) {
    return normalized as MonthlyRosterTargetType;
  }

  throw new WorkScheduleValidationError(
    `targetType must be one of ${MONTHLY_ROSTER_TARGET_TYPES.join(", ")}`,
  );
}

function normalizeRosterTargetMode(value: unknown): MonthlyRosterTargetMode {
  if (value === undefined || value === null) {
    return "EXACT_ONLY";
  }

  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `targetMode must be one of ${MONTHLY_ROSTER_TARGET_MODES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    MONTHLY_ROSTER_TARGET_MODES.includes(normalized as MonthlyRosterTargetMode)
  ) {
    return normalized as MonthlyRosterTargetMode;
  }

  throw new WorkScheduleValidationError(
    `targetMode must be one of ${MONTHLY_ROSTER_TARGET_MODES.join(", ")}`,
  );
}

function normalizeRosterExceptionCommand(
  command: AddRosterExceptionCommand | UpdateRosterExceptionCommand,
  expectExceptionId: boolean,
): NormalizedRosterExceptionCommand {
  const exceptionType = normalizeExceptionType(command.exceptionType);

  return {
    monthlyRosterId: normalizeRequiredText(
      command.monthlyRosterId,
      "monthlyRosterId",
    ),
    rosterExceptionId: expectExceptionId
      ? normalizeRequiredText(
          (command as UpdateRosterExceptionCommand).rosterExceptionId,
          "rosterExceptionId",
        )
      : undefined,
    exceptionType,
    exceptionDate: normalizeDateOnly(command.exceptionDate, "exceptionDate"),
    subjectEmploymentProfileId: normalizeRequiredText(
      command.subjectEmploymentProfileId,
      "subjectEmploymentProfileId",
    ),
    title: normalizeOptionalNullableText(command.title, "title") ?? null,
    startLocalTime:
      command.startLocalTime === undefined
        ? null
        : normalizeLocalTime(command.startLocalTime, "startLocalTime"),
    workingMinutes:
      command.workingMinutes === undefined
        ? null
        : normalizePositiveInteger(command.workingMinutes, "workingMinutes"),
    breakMinutes:
      command.breakMinutes === undefined
        ? null
        : normalizeNonNegativeInteger(command.breakMinutes, "breakMinutes"),
    studioResourceIds: normalizeStudioResourceIds(command.studioResourceIds),
    reason: normalizeOptionalNullableText(command.reason, "reason") ?? null,
    sourceNote:
      normalizeOptionalNullableText(command.sourceNote, "sourceNote") ?? null,
    description:
      normalizeOptionalNullableText(command.description, "description") ?? null,
    externalRef:
      normalizeOptionalNullableText(command.externalRef, "externalRef") ?? null,
    requestedScope: parseRequestedScope(command.scope),
  };
}

function normalizeApplyAvailabilityLinesCommand(
  command: ApplyAvailabilityLinesToMonthlyRosterCommand,
): NormalizedApplyAvailabilityLinesCommand {
  const availabilityLineIds = normalizeStringIdList(
    command.availabilityLineIds,
    "availabilityLineIds",
  );
  const applyNote =
    normalizeOptionalNullableText(
      command.applyNote ?? command.note,
      "applyNote",
    ) ?? null;

  if (applyNote && applyNote.length > 1000) {
    throw new WorkScheduleValidationError(
      "applyNote must be at most 1000 characters",
    );
  }

  return {
    monthlyRosterId: normalizeRequiredText(
      command.monthlyRosterId,
      "monthlyRosterId",
    ),
    availabilityLineIds,
    applyNote,
    expectedRosterVersion: normalizeOptionalVersion(
      command.expectedRosterVersion,
      "expectedRosterVersion",
    ),
    expectedRequestVersions: normalizeExpectedRequestVersions(
      command.expectedRequestVersions,
    ),
    idempotencyKey:
      normalizeOptionalNullableText(command.idempotencyKey, "idempotencyKey") ??
      null,
    requestedScope: parseRequestedScope(command.scope),
  };
}

function normalizeOptionalVersion(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new WorkScheduleValidationError(
      `${field} must be a non-negative safe integer`,
    );
  }
  return value;
}

function normalizeExpectedRequestVersions(
  value: unknown,
): Readonly<Record<string, number>> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkScheduleValidationError(
      "expectedRequestVersions must be an object",
    );
  }
  const normalized: Record<string, number> = {};
  for (const [lineId, version] of Object.entries(value)) {
    const id = normalizeRequiredText(lineId, "expectedRequestVersions line id");
    normalized[id] = normalizeOptionalVersion(
      version,
      `expectedRequestVersions.${id}`,
    ) as number;
  }
  return normalized;
}

function normalizeStringIdList(
  value: unknown,
  field: string,
): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new WorkScheduleValidationError(
      `${field} must contain at least one id`,
    );
  }

  if (value.length > 50) {
    throw new WorkScheduleValidationError(
      `${field} must contain at most 50 ids`,
    );
  }

  const ids = value.map((item, index) =>
    normalizeRequiredText(item, `${field}[${index}]`),
  );

  if (new Set(ids).size !== ids.length) {
    throw new WorkScheduleValidationError(
      `${field} must not contain duplicate ids`,
    );
  }

  return ids;
}

function buildMonthlyRosterDraftPatch(params: {
  readonly current: MonthlyRosterRecord;
  readonly input: NormalizedUpdateMonthlyRosterDraftCommand;
}): UpdateMonthlyRosterDraftInput {
  const patch: {
    monthlyRosterId: string;
    updatedAt: number;
    rosterMonth?: string;
    targetType?: MonthlyRosterTargetType;
    targetMode?: MonthlyRosterTargetMode;
    targetOrgUnitId?: string | null;
    targetTalentGroupId?: string | null;
    departmentOrgUnitId?: string | null;
    workPatternId?: string;
    holidayCalendarId?: string;
    description?: string | null;
    externalRef?: string | null;
  } = {
    monthlyRosterId: params.current.monthlyRosterId,
    updatedAt: Date.now(),
  };

  if (
    params.input.rosterMonth !== undefined &&
    params.input.rosterMonth !== params.current.rosterMonth
  ) {
    patch.rosterMonth = params.input.rosterMonth;
  }

  const candidateTarget = mergeRosterTarget(params.current, params.input);

  if (!areRosterTargetsEqual(candidateTarget, params.current)) {
    patch.targetType = candidateTarget.targetType;
    patch.targetMode = candidateTarget.targetMode;
    patch.targetOrgUnitId = candidateTarget.targetOrgUnitId;
    patch.targetTalentGroupId = candidateTarget.targetTalentGroupId;
    patch.departmentOrgUnitId = candidateTarget.departmentOrgUnitId;
  }

  if (
    params.input.workPatternId !== undefined &&
    params.input.workPatternId !== params.current.workPatternId
  ) {
    patch.workPatternId = params.input.workPatternId;
  }

  if (
    params.input.holidayCalendarId !== undefined &&
    params.input.holidayCalendarId !== params.current.holidayCalendarId
  ) {
    patch.holidayCalendarId = params.input.holidayCalendarId;
  }

  if (
    params.input.description !== undefined &&
    params.input.description !== params.current.description
  ) {
    patch.description = params.input.description;
  }

  if (
    params.input.externalRef !== undefined &&
    params.input.externalRef !== params.current.externalRef
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
    "targetType",
    "targetMode",
    "targetOrgUnitId",
    "targetTalentGroupId",
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
    "targetType",
    "targetMode",
    "targetOrgUnitId",
    "targetTalentGroupId",
    "departmentOrgUnitId",
    "workPatternId",
    "holidayCalendarId",
  ];
  const structuralChangeRequested = changedFields.some((field) =>
    structuralFields.includes(field),
  );

  if (!structuralChangeRequested) {
    return;
  }

  const hasActiveDraftExceptions = roster.exceptions.some(
    (exception) => exception.status === "ACTIVE",
  );

  if (!hasActiveDraftExceptions) {
    return;
  }

  throw new WorkScheduleStateError(
    "Structural Monthly Roster fields cannot be changed while active draft exceptions exist; remove active exceptions before changing rosterMonth, target, workPatternId, or holidayCalendarId",
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
    subjectEmploymentProfileId: params.input.subjectEmploymentProfileId,
    status: "ACTIVE",
    title: params.input.title,
    startLocalTime: params.input.startLocalTime,
    endLocalTime,
    workingMinutes: params.input.workingMinutes,
    breakMinutes: params.input.breakMinutes,
    studioResourceIds: [...params.input.studioResourceIds],
    reason: params.input.reason,
    sourceNote: params.input.sourceNote,
    sourceAvailabilityBatchId: null,
    sourceAvailabilityLineId: null,
    sourceAvailabilityType: null,
    sourceAvailabilityTaxonomyCode: null,
    sourceAppliedAt: null,
    sourceAppliedByActorId: null,
    sourceApplyNote: null,
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
    rosterExceptionId: params.input.rosterExceptionId as string,
    updatedAt: params.now,
  };

  for (const [field, value] of Object.entries({
    exceptionType: params.input.exceptionType,
    exceptionDate: params.input.exceptionDate,
    subjectEmploymentProfileId: params.input.subjectEmploymentProfileId,
    title: params.input.title,
    startLocalTime: params.input.startLocalTime,
    endLocalTime,
    workingMinutes: params.input.workingMinutes,
    breakMinutes: params.input.breakMinutes,
    studioResourceIds: [...params.input.studioResourceIds],
    reason: params.input.reason,
    sourceNote: params.input.sourceNote,
    description: params.input.description,
    externalRef: params.input.externalRef,
  })) {
    const current = (params.existing as unknown as Record<string, unknown>)[
      field
    ];

    if (Array.isArray(value) && Array.isArray(current)) {
      if (!areStringArraysEqual(value, current)) {
        (patch as unknown as Record<string, unknown>)[field] = value;
      }
      continue;
    }

    if (value !== current) {
      (patch as unknown as Record<string, unknown>)[field] = value;
    }
  }

  return patch;
}

function summarizeRosterExceptionPatch(
  patch: UpdateRosterExceptionInput,
): readonly string[] {
  return Object.keys(patch).filter(
    (field) =>
      !["monthlyRosterId", "rosterExceptionId", "updatedAt"].includes(field),
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

function assertDraftRoster(roster: MonthlyRosterRecord): void {
  if (roster.status === "DRAFT") {
    return;
  }

  throw new WorkScheduleStateError(
    `Monthly Roster mutation requires status DRAFT, received ${roster.status}`,
  );
}

function assertRosterPublishBaseState(roster: MonthlyRosterRecord): void {
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

  if (roster.targetSubjectKind !== MONTHLY_ROSTER_TARGET_SUBJECT_KIND) {
    throw new WorkScheduleValidationError(
      "Monthly Roster publish supports only EMPLOYMENT_PROFILE targets in MVP-A",
    );
  }

  if (
    roster.targetOrgUnitMode !== MONTHLY_ROSTER_TARGET_ORG_UNIT_MODE ||
    roster.targetMode !== "EXACT_ONLY"
  ) {
    throw new WorkScheduleValidationError(
      "Monthly Roster publish supports only EXACT_ONLY targets",
    );
  }
}

function assertPreviewCanPublish(preview: {
  readonly rows: readonly MonthlyRosterPreviewRowView[];
  readonly summary: {
    readonly totalConflicts: number;
    readonly includedMemberCount?: number;
  };
}): void {
  if (preview.summary.includedMemberCount === 0) {
    throw new WorkScheduleValidationError(
      "Monthly Roster publish requires at least one eligible active Employment Profile",
    );
  }

  const blockerCount = preview.rows.reduce(
    (total, row) => total + row.blockers.length,
    0,
  );

  if (preview.summary.totalConflicts > 0 || blockerCount > 0) {
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
    sourceGenerationRunId: params.roster.publishGenerationRunId,
    publishedAt: params.roster.publishedAt,
    publishedByUserId: params.roster.publishedByUserId,
    publicationVersion: params.roster.publicationVersion,
    sourceSnapshot: params.roster.sourceSnapshot,
    generatedWorkShiftCount: params.generatedWorkShiftCount,
    skippedWorkingToOffCount: params.skippedWorkingToOffCount,
    holidaySuppressedCount: params.holidaySuppressedCount,
    changeTimeCount: params.changeTimeCount,
    addSpecialShiftCount: params.addSpecialShiftCount,
    conflictCount: params.conflictCount,
    computedPreviewHash: params.computedPreviewHash,
    generatedWorkShiftIds: [...params.generatedWorkShiftIds],
  };
}

function buildApplyAvailabilityResult(
  roster: MonthlyRosterRecord,
  results: readonly ApplyAvailabilityLineResult[],
  metadata: {
    readonly beforeSnapshot: {
      readonly draftVersion: number;
      readonly activeRosterExceptionIds: readonly string[];
    };
    readonly requestVersions: Readonly<Record<string, number>>;
    readonly auditReference: string;
  },
): ApplyAvailabilityLinesToMonthlyRosterResult {
  const failedCount = results.filter(
    (result) => result.outcome === "FAILED",
  ).length;
  const replayed = results.every(
    (result) => result.outcome === "SKIPPED_ALREADY_APPLIED",
  );
  return {
    monthlyRosterId: roster.monthlyRosterId,
    rosterCode: roster.rosterCode,
    rosterMonth: roster.rosterMonth,
    status: roster.status,
    targetType: roster.targetType,
    targetMode: roster.targetMode,
    targetOrgUnitId: roster.targetOrgUnitId,
    targetTalentGroupId: roster.targetTalentGroupId,
    appliedCount: results.filter((result) => result.outcome === "APPLIED")
      .length,
    advisoryOnlyCount: results.filter(
      (result) => result.outcome === "ADVISORY_ONLY",
    ).length,
    skippedAlreadyAppliedCount: results.filter(
      (result) => result.outcome === "SKIPPED_ALREADY_APPLIED",
    ).length,
    failedCount,
    results: results.map((result) => ({
      ...result,
      rosterExceptionIds: [...result.rosterExceptionIds],
    })),
    finalState:
      failedCount > 0
        ? "APPLICATION_FAILED"
        : results.some((result) => result.outcome === "ADVISORY_ONLY")
          ? "APPLICATION_CONFLICT"
          : "APPROVED_APPLIED",
    sourceVersions: {
      rosterVersionBefore: metadata.beforeSnapshot.draftVersion,
      rosterVersionAfter: roster.draftVersion,
      requestVersions: metadata.requestVersions,
    },
    beforeSnapshot: metadata.beforeSnapshot,
    afterSnapshot: {
      draftVersion: roster.draftVersion,
      activeRosterExceptionIds: roster.exceptions
        .filter((exception) => exception.status === "ACTIVE")
        .map((exception) => exception.rosterExceptionId),
    },
    conflicts: results
      .filter((result) => result.finalState === "APPLICATION_CONFLICT")
      .map((result) => result.reason),
    auditReference: metadata.auditReference,
    idempotencyResult: replayed ? "REPLAYED" : "APPLIED",
  };
}

async function reconcileAvailabilityBatchState(
  repository: WorkScheduleAvailabilityBatchRepository,
  batchId: string,
  now: number,
  session: ClientSession,
): Promise<void> {
  const lines = await repository.listLinesByBatchId(batchId, session);
  const lineCounts = {
    total: lines.length,
    pending: lines.filter((line) => line.status === "PENDING").length,
    approved: lines.filter((line) => line.status === "APPROVED").length,
    rejected: lines.filter((line) => line.status === "REJECTED").length,
    cancelled: lines.filter((line) => line.status === "CANCELLED").length,
  };
  const status =
    lineCounts.total > 0 && lineCounts.approved === lineCounts.total
      ? "APPROVED"
      : lineCounts.approved > 0
        ? "PARTIALLY_APPROVED"
        : lineCounts.pending > 0
          ? "PENDING"
          : lineCounts.cancelled === lineCounts.total
            ? "CANCELLED"
            : "REJECTED";
  const updated = await repository.updateBatchDerived(
    {
      batchId,
      status,
      lineCounts,
      updatedAt: now,
      ...(lineCounts.pending === 0 ? { resolvedAt: now } : {}),
    },
    session,
  );
  if (!updated) {
    throw new WorkScheduleConflictError(
      `APPLICATION_FAILED: failed to update availability batch ${batchId}`,
    );
  }
}

function prepareAvailabilityApplyLine(params: {
  readonly line: WorkScheduleAvailabilityLineRecord;
  readonly batch: WorkScheduleAvailabilityBatchRecord | null;
  readonly roster: MonthlyRosterRecord;
  readonly pattern: WorkPatternRecord;
  readonly calendar: HolidayCalendarRecord;
  readonly eligibleProfileIds: ReadonlySet<string>;
  readonly applyNote: string | null;
}):
  | {
      readonly outcome: "READY";
      readonly exceptions: readonly AvailabilityExceptionDraft[];
    }
  | {
      readonly outcome: "FAILED" | "ADVISORY_ONLY";
      readonly reason: string;
    } {
  const { line, batch, roster } = params;

  if (!batch) {
    return {
      outcome: "FAILED",
      reason: "Availability batch was not found",
    };
  }

  if (line.status !== "APPROVED") {
    return {
      outcome: "FAILED",
      reason: "Only APPROVED availability lines can be applied",
    };
  }

  if (line.applyStatus === "APPLIED") {
    if (line.appliedRosterId === roster.monthlyRosterId) {
      return {
        outcome: "FAILED",
        reason:
          "Availability line is marked APPLIED but no matching active source exception was found",
      };
    }

    return {
      outcome: "FAILED",
      reason:
        "Availability line was already applied to a different Monthly Roster",
    };
  }

  if (
    batch.targetType !== roster.targetType ||
    batch.targetMode !== roster.targetMode ||
    batch.targetOrgUnitId !== roster.targetOrgUnitId ||
    batch.targetTalentGroupId !== roster.targetTalentGroupId ||
    line.targetType !== roster.targetType ||
    line.targetOrgUnitId !== roster.targetOrgUnitId ||
    line.targetTalentGroupId !== roster.targetTalentGroupId
  ) {
    return {
      outcome: "FAILED",
      reason: "Availability target does not match Monthly Roster target",
    };
  }

  if (
    batch.periodMonth !== roster.rosterMonth ||
    line.periodMonth !== roster.rosterMonth
  ) {
    return {
      outcome: "FAILED",
      reason: "Availability periodMonth does not match Monthly Roster month",
    };
  }

  if (!params.eligibleProfileIds.has(line.memberEmploymentProfileId)) {
    return {
      outcome: "FAILED",
      reason:
        "Availability member is no longer eligible for the Monthly Roster target",
    };
  }

  if (
    line.dateRangeStart.slice(0, 7) !== roster.rosterMonth ||
    line.dateRangeEnd.slice(0, 7) !== roster.rosterMonth
  ) {
    return {
      outcome: "FAILED",
      reason: "Availability date range is outside Monthly Roster month",
    };
  }

  if (line.availabilityType === "OTHER_AVAILABILITY_NOTE") {
    return {
      outcome: "ADVISORY_ONLY",
      reason:
        "OTHER_AVAILABILITY_NOTE is advisory and does not create Monthly Roster exceptions",
    };
  }

  const dates = enumerateDateRange(line.dateRangeStart, line.dateRangeEnd);

  if (line.availabilityType === "UNAVAILABLE_FULL_DAY") {
    for (const date of dates) {
      try {
        assertStandardRosterCandidate({
          date,
          pattern: params.pattern,
          calendar: params.calendar,
        });
      } catch (error) {
        return {
          outcome: "FAILED",
          reason:
            error instanceof Error
              ? error.message
              : "Availability date cannot be represented as a roster exception",
        };
      }
    }

    return {
      outcome: "READY",
      exceptions: dates.map((date) => ({
        exceptionDate: date,
        exceptionType: "WORKING_TO_OFF",
        startLocalTime: null,
        endLocalTime: null,
      })),
    };
  }

  if (line.availabilityType === "PREFERRED_TIME") {
    if (
      line.preferredStartLocalTime === null ||
      line.preferredEndLocalTime === null
    ) {
      return {
        outcome: "FAILED",
        reason: "PREFERRED_TIME line is missing preferred start or end time",
      };
    }

    let expectedEnd: string;
    try {
      expectedEnd = calculateEndLocalTime({
        startLocalTime: line.preferredStartLocalTime,
        workingMinutes: params.pattern.workingMinutes,
        breakMinutes: params.pattern.breakMinutes,
      });
    } catch (error) {
      return {
        outcome: "FAILED",
        reason:
          error instanceof Error
            ? error.message
            : "PREFERRED_TIME cannot be represented safely",
      };
    }

    if (expectedEnd !== line.preferredEndLocalTime) {
      return {
        outcome: "FAILED",
        reason:
          "PREFERRED_TIME preferredEndLocalTime does not match the Monthly Roster pattern duration and cannot be represented without data loss",
      };
    }

    for (const date of dates) {
      try {
        assertStandardRosterCandidate({
          date,
          pattern: params.pattern,
          calendar: params.calendar,
        });
      } catch (error) {
        return {
          outcome: "FAILED",
          reason:
            error instanceof Error
              ? error.message
              : "Availability date cannot be represented as a roster exception",
        };
      }
    }

    return {
      outcome: "READY",
      exceptions: dates.map((date) => ({
        exceptionDate: date,
        exceptionType: "CHANGE_TIME",
        startLocalTime: line.preferredStartLocalTime,
        endLocalTime: expectedEnd,
      })),
    };
  }

  return {
    outcome: "FAILED",
    reason: `Unsupported availabilityType: ${line.availabilityType}`,
  };
}

function buildRosterExceptionFromAvailability(params: {
  readonly roster: MonthlyRosterRecord;
  readonly line: WorkScheduleAvailabilityLineRecord;
  readonly draft: AvailabilityExceptionDraft;
  readonly applyNote: string | null;
  readonly actorId: string;
  readonly now: number;
}): RosterExceptionRecord {
  return {
    rosterExceptionId: crypto.randomUUID(),
    monthlyRosterId: params.roster.monthlyRosterId,
    exceptionType: params.draft.exceptionType,
    exceptionDate: params.draft.exceptionDate,
    subjectEmploymentProfileId: params.line.memberEmploymentProfileId,
    status: "ACTIVE",
    title: null,
    startLocalTime: params.draft.startLocalTime,
    endLocalTime: params.draft.endLocalTime,
    workingMinutes: null,
    breakMinutes: null,
    studioResourceIds: [],
    reason: params.line.reason,
    sourceNote: params.applyNote,
    sourceAvailabilityBatchId: params.line.batchId,
    sourceAvailabilityLineId: params.line.id,
    sourceAvailabilityType: params.line.availabilityType,
    sourceAvailabilityTaxonomyCode: params.line.taxonomyCode,
    sourceAppliedAt: params.now,
    sourceAppliedByActorId: params.actorId,
    sourceApplyNote: params.applyNote,
    description: null,
    externalRef: null,
    removedAt: null,
    createdAt: params.now,
    updatedAt: params.now,
  };
}

function findActiveAvailabilitySourceExceptions(
  roster: MonthlyRosterRecord,
  availabilityLineId: string,
): readonly RosterExceptionRecord[] {
  return roster.exceptions.filter(
    (exception) =>
      exception.status === "ACTIVE" &&
      exception.sourceAvailabilityLineId === availabilityLineId,
  );
}

function hasActiveStandardExceptionForDate(
  roster: MonthlyRosterRecord,
  subjectEmploymentProfileId: string,
  exceptionDate: string,
): boolean {
  return roster.exceptions.some(
    (exception) =>
      exception.status === "ACTIVE" &&
      exception.subjectEmploymentProfileId === subjectEmploymentProfileId &&
      exception.exceptionDate === exceptionDate &&
      exception.exceptionType !== "ADD_SPECIAL_SHIFT",
  );
}

function enumerateDateRange(
  startDate: string,
  endDate: string,
): readonly string[] {
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);
  const cursor = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  const end = Date.UTC(endYear, endMonth - 1, endDay);
  const dates: string[] = [];

  while (cursor.getTime() <= end) {
    dates.push(
      `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`,
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function requireActiveException(
  roster: MonthlyRosterRecord,
  rosterExceptionId: string,
): RosterExceptionRecord {
  const exception = roster.exceptions.find(
    (candidate) => candidate.rosterExceptionId === rosterExceptionId,
  );

  if (!exception) {
    throw new WorkScheduleNotFoundError(rosterExceptionId);
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
      exception.rosterExceptionId !== input.rosterExceptionId &&
      exception.subjectEmploymentProfileId ===
        input.subjectEmploymentProfileId &&
      exception.exceptionDate === input.exceptionDate &&
      exception.exceptionType !== "ADD_SPECIAL_SHIFT",
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
    (entry) => entry.status === "ACTIVE" && entry.date === params.date,
  );

  if (activeHoliday) {
    throw new WorkScheduleValidationError(
      "Roster exception cannot target a calendar holiday/off-day standard candidate",
    );
  }
}

function assertDateWithinRosterMonth(date: string, rosterMonth: string): void {
  assertWorkScheduleDateOnlyWithinRosterMonth(date, rosterMonth, {
    field: "exceptionDate",
    outsideMonthMessage: "exceptionDate must be inside rosterMonth",
  });
}

function getRosterTargetId(
  target: Pick<
    NormalizedMonthlyRosterTarget,
    "targetType" | "targetOrgUnitId" | "targetTalentGroupId"
  >,
): string {
  return target.targetType === "ORG_UNIT"
    ? requireRosterTargetId(target.targetOrgUnitId, "targetOrgUnitId")
    : requireRosterTargetId(target.targetTalentGroupId, "targetTalentGroupId");
}

function requireRosterTargetId(value: string | null, field: string): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  throw new WorkScheduleValidationError(`${field} is required`);
}

function areRosterTargetsEqual(
  left: NormalizedMonthlyRosterTarget,
  right: NormalizedMonthlyRosterTarget,
): boolean {
  return (
    left.targetType === right.targetType &&
    left.targetMode === right.targetMode &&
    left.targetOrgUnitId === right.targetOrgUnitId &&
    left.targetTalentGroupId === right.targetTalentGroupId
  );
}

function getTalentGroupMemberExclusionReason(
  resolution: {
    readonly membershipStatus: string;
    readonly talentOperationalStatus: string | null;
    readonly linkedEmploymentProfileId: string | null;
    readonly employmentProfile: WorkScheduleReferencedEmploymentProfile | null;
  },
  seenEmploymentProfileIds: ReadonlySet<string>,
): MonthlyRosterMemberExclusionReasonCode | null {
  if (resolution.membershipStatus !== "ACTIVE") {
    return "MEMBERSHIP_INACTIVE";
  }

  if (resolution.talentOperationalStatus === null) {
    return "TALENT_NOT_FOUND";
  }

  if (resolution.talentOperationalStatus !== "ACTIVE") {
    return "TALENT_INACTIVE";
  }

  if (!resolution.linkedEmploymentProfileId) {
    return "MISSING_LINKED_EMPLOYMENT_PROFILE";
  }

  if (!resolution.employmentProfile) {
    return "EMPLOYMENT_PROFILE_NOT_FOUND";
  }

  if (resolution.employmentProfile.employmentStatus !== "ACTIVE") {
    return "EMPLOYMENT_PROFILE_INACTIVE";
  }

  if (seenEmploymentProfileIds.has(resolution.employmentProfile.id)) {
    return "DUPLICATE_EMPLOYMENT_PROFILE";
  }

  return null;
}

function normalizeRosterMonth(value: unknown): string {
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      "rosterMonth must be a YYYY-MM string",
    );
  }

  const normalized = value.trim();
  const match = /^(\d{4})-(\d{2})$/u.exec(normalized);

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

function normalizeDateOnly(value: unknown, field: string): string {
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

function normalizeExceptionType(value: unknown): RosterExceptionType {
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `exceptionType must be one of ${ROSTER_EXCEPTION_TYPES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (ROSTER_EXCEPTION_TYPES.includes(normalized as RosterExceptionType)) {
    return normalized as RosterExceptionType;
  }

  throw new WorkScheduleValidationError(
    `exceptionType must be one of ${ROSTER_EXCEPTION_TYPES.join(", ")}`,
  );
}

function normalizeLocalTime(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `${field} must be a local HH:mm time`,
    );
  }

  const normalized = value.trim();

  if (!/^([01]\d|2[0-3]):([0-5]\d)$/u.test(normalized)) {
    throw new WorkScheduleValidationError(
      `${field} must be a valid HH:mm 24-hour local time`,
    );
  }

  return normalized;
}

function normalizePositiveInteger(value: unknown, field: string): number {
  return normalizeIntegerAtLeast(value, field, 1);
}

function normalizeNonNegativeInteger(value: unknown, field: string): number {
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

function normalizeStudioResourceIds(value: unknown): readonly string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new WorkScheduleValidationError("studioResourceIds must be an array");
  }

  const ids = value.map((item, index) =>
    normalizeRequiredText(item, `studioResourceIds[${index}]`),
  );
  const distinct = new Set(ids);

  if (distinct.size !== ids.length) {
    throw new WorkScheduleValidationError(
      "studioResourceIds must not contain duplicate values",
    );
  }

  return [...distinct].sort();
}

function parseRequestedScope(value: unknown): "global" | undefined {
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

function normalizeRequiredText(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(`${field} must be a string`);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new WorkScheduleValidationError(`${field} is required`);
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
    throw new WorkScheduleValidationError(`${field} must be a string`);
  }

  const normalized = value.trim();

  return normalized.length > 0 ? normalized : undefined;
}

function calculateEndLocalTime(params: {
  readonly startLocalTime: string;
  readonly workingMinutes: number;
  readonly breakMinutes: number;
}): string {
  const start = parseLocalTimeMinutes(params.startLocalTime);
  const total = start + params.workingMinutes + params.breakMinutes;

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

function weekdayTokenForDate(date: string): WorkPatternWeekdayToken {
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const tokens: readonly WorkPatternWeekdayToken[] = [
    "SUN",
    "MON",
    "TUE",
    "WED",
    "THU",
    "FRI",
    "SAT",
  ];

  return tokens[parsed.getUTCDay()];
}

function toVietnamLocalUtcMillis(date: string, time: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);

  return Date.UTC(year, month - 1, day, hour - 7, minute);
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
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function toUtcShiftCodeDateBucket(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}${month}${day}`;
}

function formatGeneratedShiftCode(
  dateBucket: string,
  sequence: number,
): string {
  return `WS-${dateBucket}-${String(sequence).padStart(4, "0")}`;
}

function toRosterMonthCodeBucket(rosterMonth: string): string {
  return rosterMonth.replace("-", "");
}

function formatGeneratedRosterCode(
  monthBucket: string,
  sequence: number,
): string {
  return `MR-${monthBucket}-${String(sequence).padStart(6, "0")}`;
}

function assertAdminActorType(actor: Actor): void {
  PermissionGuard.assertAdminActor(actor);
}

function createMissingTalentGroupReadonlyAccess(): WorkScheduleTalentGroupReadonlyAccess {
  return {
    async findById(): Promise<null> {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "WorkScheduleTalentGroupReadonlyAccess is required for Monthly Roster Talent Group targets",
      );
    },
  };
}

function createMissingAvailabilityRepository(): WorkScheduleAvailabilityBatchRepository {
  const fail = async (): Promise<never> => {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "WorkScheduleAvailabilityBatchRepository is required to apply availability lines to Monthly Roster",
    );
  };

  return {
    insertBatchWithLines: fail,
    findBatchById: fail,
    findBatchByClientToken: fail,
    listBatches: fail,
    listLinesByBatchId: fail,
    findLineById: fail,
    listLinesByIds: fail,
    findPendingDuplicateLine: fail,
    transitionLineStatus: fail,
    updateBatchDerived: fail,
    updateLineApplyState: fail,
  };
}

function createMissingStructuredAuthority(): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService({
    async listByUserId() {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "StructuredScopeAuthorityService is required for Monthly Roster operations",
      );
    },
  });
}

function buildStructuredRosterScope(
  target: Pick<
    NormalizedMonthlyRosterTarget,
    "targetType" | "targetMode" | "targetOrgUnitId" | "targetTalentGroupId"
  >,
):
  | { readonly scopeType: "managedOrgUnit"; readonly targetId: string }
  | { readonly scopeType: "managedTalentGroup"; readonly targetId: string } {
  if (target.targetMode !== "EXACT_ONLY") {
    throw new WorkSchedulePermissionScopeError(
      "Monthly Roster structured authority requires targetMode EXACT_ONLY",
    );
  }

  if (target.targetType === "ORG_UNIT") {
    if (target.targetTalentGroupId !== null) {
      throw new WorkSchedulePermissionScopeError(
        "Malformed ORG_UNIT Monthly Roster target",
      );
    }
    return {
      scopeType: "managedOrgUnit",
      targetId: requireRosterTargetId(
        target.targetOrgUnitId,
        "targetOrgUnitId",
      ),
    };
  }

  if (target.targetType === "TALENT_GROUP") {
    if (target.targetOrgUnitId !== null) {
      throw new WorkSchedulePermissionScopeError(
        "Malformed TALENT_GROUP Monthly Roster target",
      );
    }
    return {
      scopeType: "managedTalentGroup",
      targetId: requireRosterTargetId(
        target.targetTalentGroupId,
        "targetTalentGroupId",
      ),
    };
  }

  throw new WorkSchedulePermissionScopeError(
    "Unsupported Monthly Roster targetType for structured authority",
  );
}

function getStructuredRosterScopeLabel(
  target: Pick<
    NormalizedMonthlyRosterTarget,
    "targetType" | "targetMode" | "targetOrgUnitId" | "targetTalentGroupId"
  >,
): "managedOrgUnit" | "managedTalentGroup" {
  return buildStructuredRosterScope(target).scopeType;
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
    targetType: record.targetType,
    targetMode: record.targetMode,
    targetOrgUnitId: record.targetOrgUnitId,
    targetTalentGroupId: record.targetTalentGroupId,
    targetRef: null,
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
    publishGenerationRunId: record.publishGenerationRunId,
    publicationVersion: record.publicationVersion,
    sourceSnapshot: record.sourceSnapshot,
    description: record.description,
    externalRef: record.externalRef,
    exceptions: record.exceptions.map((exception) => ({
      ...exception,
      studioResourceIds: [...exception.studioResourceIds],
    })),
    archivedAt: record.archivedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function isDuplicateKeyError(error: unknown): error is MongoServerError {
  return error instanceof MongoServerError && error.code === 11000;
}

function buildMutationTargetDescriptor(
  metadata: Readonly<Record<string, unknown>>,
): string {
  const encoded = JSON.stringify(metadata);

  if (typeof encoded === "string" && encoded.length > 2) {
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

  if (error instanceof WorkScheduleInvalidSubjectReferenceError) {
    return "invalid_subject_reference";
  }

  if (error instanceof WorkScheduleInvalidResourceReferenceError) {
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

function extractErrorCode(error: unknown): string | undefined {
  if (error instanceof BaseAppError) {
    return error.code;
  }

  if (error instanceof SystemInvariantError) {
    return error.code;
  }

  return undefined;
}

function truncateLogMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);

  if (raw.length <= 256) {
    return raw;
  }

  return `${raw.slice(0, 253)}...`;
}
