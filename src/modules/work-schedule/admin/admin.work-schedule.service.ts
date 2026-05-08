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
  WorkScheduleInvalidResourceReferenceError,
  WorkScheduleInvalidSubjectReferenceError,
  WorkScheduleNotFoundError,
  WorkScheduleOverlapConflictError,
  WorkSchedulePermissionScopeError,
  WorkScheduleStateError,
  WorkScheduleValidationError,
} from "@modules/work-schedule/domain/work-schedule.errors";
import { WorkShiftCodeSequenceRepository } from "@modules/work-schedule/domain/work-schedule-code-sequence.repository";
import { WorkScheduleEmploymentProfileReadonlyAccess } from "@modules/work-schedule/domain/work-schedule-employment-profile-readonly-access";
import {
  ReassignWorkShiftSubjectInput,
  ReplaceWorkShiftResourcesInput,
  RescheduleWorkShiftInput,
  TransitionWorkShiftStatusInput,
  UpdateWorkShiftCoreInput,
  WorkShiftRepository,
  WorkShiftSubjectReferenceInput,
} from "@modules/work-schedule/domain/work-schedule.repository";
import { WorkScheduleStudioResourceReadonlyAccess } from "@modules/work-schedule/domain/work-schedule-studio-resource-readonly-access";
import { WorkScheduleTalentReadonlyAccess } from "@modules/work-schedule/domain/work-schedule-talent-readonly-access";
import { WorkScheduleTalentGroupReadonlyAccess } from "@modules/work-schedule/domain/work-schedule-talent-group-readonly-access";
import {
  WORK_SHIFT_SCOPES,
  WORK_SHIFT_SUBJECT_KINDS,
  WorkShiftMutationView,
  WorkShiftRecord,
  WorkShiftScope,
  WorkShiftSubjectKind,
} from "@modules/work-schedule/domain/work-schedule.types";
import {
  ArchiveWorkShiftCommand,
  CancelWorkShiftCommand,
  CreateWorkShiftCommand,
  ReassignWorkShiftSubjectCommand,
  RescheduleWorkShiftCommand,
  UpdateWorkShiftCoreCommand,
  UpdateWorkShiftResourcesCommand,
  WorkShiftMutationResult,
} from "@modules/work-schedule/shared/work-schedule.contracts";

type WorkScheduleFailureClassification =
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

interface NormalizedSubjectReference
  extends WorkShiftSubjectReferenceInput {}

interface NormalizedCreateCommand {
  readonly shiftCode?: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly subject: NormalizedSubjectReference;
  readonly studioResourceIds: readonly string[];
  readonly shiftStartAt: number;
  readonly shiftEndAt: number;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly requestedScope?: WorkShiftScope;
}

interface NormalizedUpdateCoreCommand {
  readonly workShiftId: string;
  readonly title?: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly requestedScope?: WorkShiftScope;
}

interface NormalizedRescheduleCommand {
  readonly workShiftId: string;
  readonly newShiftStartAt: number;
  readonly newShiftEndAt: number;
  readonly requestedScope?: WorkShiftScope;
}

interface NormalizedReassignSubjectCommand {
  readonly workShiftId: string;
  readonly subject: NormalizedSubjectReference;
  readonly requestedScope?: WorkShiftScope;
}

interface NormalizedUpdateResourcesCommand {
  readonly workShiftId: string;
  readonly newStudioResourceIds: readonly string[];
  readonly requestedScope?: WorkShiftScope;
}

interface NormalizedLifecycleCommand {
  readonly workShiftId: string;
  readonly requestedScope?: WorkShiftScope;
}

export class WorkScheduleAdminService {
  constructor(
    private readonly repository: WorkShiftRepository,
    private readonly codeSequenceRepository: WorkShiftCodeSequenceRepository,
    private readonly employmentProfileReadonlyAccess: WorkScheduleEmploymentProfileReadonlyAccess,
    private readonly talentReadonlyAccess: WorkScheduleTalentReadonlyAccess,
    private readonly talentGroupReadonlyAccess: WorkScheduleTalentGroupReadonlyAccess,
    private readonly studioResourceReadonlyAccess: WorkScheduleStudioResourceReadonlyAccess,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly logger: StructuredLogger = createStructuredLogger(),
  ) {}

  async createWorkShift(
    actor: Actor,
    command: CreateWorkShiftCommand,
  ): Promise<WorkShiftMutationResult> {
    const operation = "work-schedule.create";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_CREATE,
    );
    const input = normalizeCreateCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        shiftCode: input.shiftCode ?? null,
        subjectKind: input.subject.subjectKind,
        requestedScope:
          input.requestedScope ?? null,
      },
      async (session) => {
        const scope =
          await this.resolveEffectiveScopeForSubject(
            actor,
            input.requestedScope,
            input.subject,
            session,
          );
        await this.assertScopeAccessForSubject(
          actor,
          scope,
          input.subject,
          session,
        );
        await this.assertSubjectEligibility(
          input.subject,
          session,
        );
        await this.assertStudioResourcesEligible(
          input.studioResourceIds,
          session,
        );
        await this.assertNoOverlapConflicts({
          subject: input.subject,
          studioResourceIds:
            input.studioResourceIds,
          shiftStartAt: input.shiftStartAt,
          shiftEndAt: input.shiftEndAt,
          session,
        });

        if (input.shiftCode !== undefined) {
          const existing =
            await this.repository.findByShiftCode(
              input.shiftCode,
              session,
            );

          if (existing) {
            throw new WorkScheduleConflictError(
              `Work shift code already exists: ${input.shiftCode}`,
            );
          }
        }

        const now = Date.now();
        let created!: WorkShiftRecord;

        const maxCreateAttempts =
          input.shiftCode === undefined ? 5 : 1;

        for (
          let attempt = 1;
          attempt <= maxCreateAttempts;
          attempt += 1
        ) {
          const shiftCode =
            input.shiftCode ??
            (await this.allocateGeneratedShiftCode(
              input.shiftStartAt,
              session,
            ));
          const record: WorkShiftRecord = {
            id: crypto.randomUUID(),
            shiftCode,
            normalizedShiftCode:
              canonicalizeSearchToken(shiftCode),
            title: input.title,
            normalizedTitle:
              input.normalizedTitle,
            subjectKind: input.subject.subjectKind,
            subjectEmploymentProfileId:
              input.subject
                .subjectEmploymentProfileId,
            subjectTalentId:
              input.subject.subjectTalentId,
            subjectTalentGroupId:
              input.subject
                .subjectTalentGroupId,
            studioResourceIds: [
              ...input.studioResourceIds,
            ],
            status: "ACTIVE",
            shiftStartAt: input.shiftStartAt,
            shiftEndAt: input.shiftEndAt,
            description: input.description,
            externalRef: input.externalRef,
            sourceType: "MANUAL",
            sourceRosterId: null,
            sourcePatternId: null,
            sourceExceptionId: null,
            sourceGenerationRunId: null,
            sourceRosterMonth: null,
            sourceDepartmentOrgUnitId: null,
            sourceRosterLocalDate: null,
            sourceRosterSlotKey: null,
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

            if (input.shiftCode !== undefined) {
              throw new WorkScheduleConflictError(
                `Work shift code already exists: ${input.shiftCode}`,
              );
            }

            if (attempt === maxCreateAttempts) {
              throw new WorkScheduleConflictError(
                "Generated work shift code conflict detected on create",
              );
            }
          }
        }

        await this.recordAudit({
          actor,
          permission,
          workShiftId: created.id,
          mutationType: operation,
          metadata: {
            shiftCode: created.shiftCode,
            subjectKind: created.subjectKind,
            subjectEmploymentProfileId:
              created.subjectEmploymentProfileId,
            subjectTalentId:
              created.subjectTalentId,
            subjectTalentGroupId:
              created.subjectTalentGroupId,
            studioResourceIds: [
              ...created.studioResourceIds,
            ],
            shiftStartAt: created.shiftStartAt,
            shiftEndAt: created.shiftEndAt,
            effectiveScope: scope,
          },
          session,
        });

        return toWorkShiftMutationView(created);
      },
      (result) => ({
        workShiftId: result.id,
        status: result.status,
      }),
    );
  }

  async updateWorkShiftCore(
    actor: Actor,
    command: UpdateWorkShiftCoreCommand,
  ): Promise<WorkShiftMutationResult> {
    const operation = "work-schedule.update-core";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_UPDATE,
    );
    const input =
      normalizeUpdateCoreCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        workShiftId: input.workShiftId,
        requestedScope:
          input.requestedScope ?? null,
      },
      async (session) => {
        const current = await this.requireWorkShift(
          input.workShiftId,
          session,
        );
        const scope =
          await this.resolveEffectiveScopeForSubject(
            actor,
            input.requestedScope,
            toSubjectReference(current),
            session,
          );

        assertActiveForStructuralMutation(
          current,
          operation,
        );
        await this.assertScopeAccessForSubject(
          actor,
          scope,
          toSubjectReference(current),
          session,
        );

        const patch = buildWorkShiftCorePatch({
          current,
          ...input,
        });
        const changedFields =
          summarizeChangedCoreFields(patch);

        if (changedFields.length === 0) {
          throw new WorkScheduleValidationError(
            "At least one changed core field is required",
          );
        }

        const updated =
          await this.repository.updateCore(
            patch,
            session,
          );

        if (!updated) {
          throw new WorkScheduleConflictError(
            `Failed to update work shift core: ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          workShiftId: updated.id,
          mutationType: operation,
          metadata: {
            changedFields,
            effectiveScope: scope,
          },
          session,
        });

        return toWorkShiftMutationView(updated);
      },
      (result) => ({
        workShiftId: result.id,
        status: result.status,
      }),
    );
  }

  async rescheduleWorkShift(
    actor: Actor,
    command: RescheduleWorkShiftCommand,
  ): Promise<WorkShiftMutationResult> {
    const operation = "work-schedule.reschedule";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_UPDATE,
    );
    const input =
      normalizeRescheduleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        workShiftId: input.workShiftId,
        requestedScope:
          input.requestedScope ?? null,
      },
      async (session, controls) => {
        const current = await this.requireWorkShift(
          input.workShiftId,
          session,
        );
        const scope =
          await this.resolveEffectiveScopeForSubject(
            actor,
            input.requestedScope,
            toSubjectReference(current),
            session,
          );

        assertActiveForStructuralMutation(
          current,
          operation,
        );
        await this.assertScopeAccessForSubject(
          actor,
          scope,
          toSubjectReference(current),
          session,
        );
        await this.assertNoOverlapConflicts({
          subject: toSubjectReference(current),
          studioResourceIds:
            current.studioResourceIds,
          shiftStartAt: input.newShiftStartAt,
          shiftEndAt: input.newShiftEndAt,
          excludeWorkShiftId: current.id,
          session,
        });

        if (
          current.shiftStartAt ===
            input.newShiftStartAt &&
          current.shiftEndAt ===
            input.newShiftEndAt
        ) {
          controls.markExplicitNoOpSuccess();
          return toWorkShiftMutationView(current);
        }

        const updateInput: RescheduleWorkShiftInput =
          {
            workShiftId: current.id,
            shiftStartAt: input.newShiftStartAt,
            shiftEndAt: input.newShiftEndAt,
            updatedAt: Date.now(),
          };
        const updated =
          await this.repository.reschedule(
            updateInput,
            session,
          );

        if (!updated) {
          throw new WorkScheduleConflictError(
            `Failed to reschedule work shift: ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          workShiftId: updated.id,
          mutationType: operation,
          metadata: {
            previousShiftStartAt:
              current.shiftStartAt,
            previousShiftEndAt:
              current.shiftEndAt,
            nextShiftStartAt:
              updated.shiftStartAt,
            nextShiftEndAt:
              updated.shiftEndAt,
            effectiveScope: scope,
          },
          session,
        });

        return toWorkShiftMutationView(updated);
      },
      (result) => ({
        workShiftId: result.id,
        status: result.status,
      }),
    );
  }

  async reassignWorkShiftSubject(
    actor: Actor,
    command: ReassignWorkShiftSubjectCommand,
  ): Promise<WorkShiftMutationResult> {
    const operation =
      "work-schedule.reassign-subject";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_UPDATE,
    );
    const input =
      normalizeReassignSubjectCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        workShiftId: input.workShiftId,
        newSubjectKind:
          input.subject.subjectKind,
        requestedScope:
          input.requestedScope ?? null,
      },
      async (session, controls) => {
        const current = await this.requireWorkShift(
          input.workShiftId,
          session,
        );
        const scope =
          await this.resolveEffectiveScopeForSubject(
            actor,
            input.requestedScope,
            input.subject,
            session,
          );

        assertActiveForStructuralMutation(
          current,
          operation,
        );
        await this.assertScopeAccessForSubject(
          actor,
          scope,
          input.subject,
          session,
        );
        await this.assertSubjectEligibility(
          input.subject,
          session,
        );
        await this.assertNoOverlapConflicts({
          subject: input.subject,
          studioResourceIds:
            current.studioResourceIds,
          shiftStartAt: current.shiftStartAt,
          shiftEndAt: current.shiftEndAt,
          excludeWorkShiftId: current.id,
          session,
        });

        if (
          areSubjectsEqual(
            input.subject,
            toSubjectReference(current),
          )
        ) {
          controls.markExplicitNoOpSuccess();
          return toWorkShiftMutationView(current);
        }

        const updateInput: ReassignWorkShiftSubjectInput =
          {
            workShiftId: current.id,
            subjectKind:
              input.subject.subjectKind,
            subjectEmploymentProfileId:
              input.subject
                .subjectEmploymentProfileId,
            subjectTalentId:
              input.subject.subjectTalentId,
            subjectTalentGroupId:
              input.subject
                .subjectTalentGroupId,
            updatedAt: Date.now(),
          };
        const updated =
          await this.repository.reassignSubject(
            updateInput,
            session,
          );

        if (!updated) {
          throw new WorkScheduleConflictError(
            `Failed to reassign work shift subject: ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          workShiftId: updated.id,
          mutationType: operation,
          metadata: {
            previousSubjectKind:
              current.subjectKind,
            previousSubjectEmploymentProfileId:
              current.subjectEmploymentProfileId,
            previousSubjectTalentId:
              current.subjectTalentId,
            previousSubjectTalentGroupId:
              current.subjectTalentGroupId,
            nextSubjectKind:
              updated.subjectKind,
            nextSubjectEmploymentProfileId:
              updated.subjectEmploymentProfileId,
            nextSubjectTalentId:
              updated.subjectTalentId,
            nextSubjectTalentGroupId:
              updated.subjectTalentGroupId,
            effectiveScope: scope,
          },
          session,
        });

        return toWorkShiftMutationView(updated);
      },
      (result) => ({
        workShiftId: result.id,
        status: result.status,
      }),
    );
  }

  async updateWorkShiftResources(
    actor: Actor,
    command: UpdateWorkShiftResourcesCommand,
  ): Promise<WorkShiftMutationResult> {
    const operation =
      "work-schedule.update-resources";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_UPDATE,
    );
    const input =
      normalizeUpdateResourcesCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        workShiftId: input.workShiftId,
        requestedScope:
          input.requestedScope ?? null,
      },
      async (session, controls) => {
        const current = await this.requireWorkShift(
          input.workShiftId,
          session,
        );
        const scope =
          await this.resolveEffectiveScopeForSubject(
            actor,
            input.requestedScope,
            toSubjectReference(current),
            session,
          );

        assertActiveForStructuralMutation(
          current,
          operation,
        );
        await this.assertScopeAccessForSubject(
          actor,
          scope,
          toSubjectReference(current),
          session,
        );
        await this.assertStudioResourcesEligible(
          input.newStudioResourceIds,
          session,
        );
        await this.assertNoResourceOverlapConflicts({
          studioResourceIds:
            input.newStudioResourceIds,
          shiftStartAt: current.shiftStartAt,
          shiftEndAt: current.shiftEndAt,
          excludeWorkShiftId: current.id,
          session,
        });

        if (
          areCanonicalResourceSetsEqual(
            current.studioResourceIds,
            input.newStudioResourceIds,
          )
        ) {
          controls.markExplicitNoOpSuccess();
          return toWorkShiftMutationView(current);
        }

        const updateInput: ReplaceWorkShiftResourcesInput =
          {
            workShiftId: current.id,
            studioResourceIds: [
              ...input.newStudioResourceIds,
            ],
            updatedAt: Date.now(),
          };
        const updated =
          await this.repository.replaceResources(
            updateInput,
            session,
          );

        if (!updated) {
          throw new WorkScheduleConflictError(
            `Failed to update work shift resources: ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          workShiftId: updated.id,
          mutationType: operation,
          metadata: {
            previousStudioResourceIds: [
              ...current.studioResourceIds,
            ],
            nextStudioResourceIds: [
              ...updated.studioResourceIds,
            ],
            effectiveScope: scope,
          },
          session,
        });

        return toWorkShiftMutationView(updated);
      },
      (result) => ({
        workShiftId: result.id,
        status: result.status,
      }),
    );
  }

  async cancelWorkShift(
    actor: Actor,
    command: CancelWorkShiftCommand,
  ): Promise<WorkShiftMutationResult> {
    const operation = "work-schedule.cancel";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
    );
    const input =
      normalizeLifecycleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        workShiftId: input.workShiftId,
        requestedScope:
          input.requestedScope ?? null,
      },
      async (session) => {
        const current = await this.requireWorkShift(
          input.workShiftId,
          session,
        );
        const scope =
          await this.resolveEffectiveScopeForSubject(
            actor,
            input.requestedScope,
            toSubjectReference(current),
            session,
          );

        await this.assertScopeAccessForSubject(
          actor,
          scope,
          toSubjectReference(current),
          session,
        );

        if (current.status !== "ACTIVE") {
          throw new WorkScheduleStateError(
            `Work shift ${current.id} cannot transition from ${current.status} to CANCELLED`,
          );
        }

        const transition: TransitionWorkShiftStatusInput =
          {
            workShiftId: current.id,
            fromStatuses: ["ACTIVE"],
            toStatus: "CANCELLED",
            updatedAt: Date.now(),
          };
        const updated =
          await this.repository.transitionStatus(
            transition,
            session,
          );

        if (!updated) {
          throw new WorkScheduleConflictError(
            `Failed to cancel work shift: ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          workShiftId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            effectiveScope: scope,
          },
          session,
        });

        return toWorkShiftMutationView(updated);
      },
      (result) => ({
        workShiftId: result.id,
        status: result.status,
      }),
    );
  }

  async archiveWorkShift(
    actor: Actor,
    command: ArchiveWorkShiftCommand,
  ): Promise<WorkShiftMutationResult> {
    const operation = "work-schedule.archive";
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
    );
    const input =
      normalizeLifecycleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        workShiftId: input.workShiftId,
        requestedScope:
          input.requestedScope ?? null,
      },
      async (session) => {
        const current = await this.requireWorkShift(
          input.workShiftId,
          session,
        );
        const scope =
          await this.resolveEffectiveScopeForSubject(
            actor,
            input.requestedScope,
            toSubjectReference(current),
            session,
          );

        await this.assertScopeAccessForSubject(
          actor,
          scope,
          toSubjectReference(current),
          session,
        );

        const evaluationTime = Date.now();
        let fromStatuses: readonly WorkShiftRecord["status"][];

        if (current.status === "CANCELLED") {
          fromStatuses = ["CANCELLED"];
        } else if (current.status === "ACTIVE") {
          if (current.shiftEndAt > evaluationTime) {
            throw new WorkScheduleStateError(
              `Work shift ${current.id} cannot archive before shift end`,
            );
          }

          fromStatuses = ["ACTIVE"];
        } else {
          throw new WorkScheduleStateError(
            `Work shift ${current.id} cannot transition from ${current.status} to ARCHIVED`,
          );
        }

        const transition: TransitionWorkShiftStatusInput =
          {
            workShiftId: current.id,
            fromStatuses,
            toStatus: "ARCHIVED",
            updatedAt: evaluationTime,
          };
        const updated =
          await this.repository.transitionStatus(
            transition,
            session,
          );

        if (!updated) {
          throw new WorkScheduleConflictError(
            `Failed to archive work shift: ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          workShiftId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            effectiveScope: scope,
          },
          session,
        });

        return toWorkShiftMutationView(updated);
      },
      (result) => ({
        workShiftId: result.id,
        status: result.status,
      }),
    );
  }

  private async resolveEffectiveScopeForSubject(
    actor: Actor,
    requestedScope: WorkShiftScope | undefined,
    subject: NormalizedSubjectReference,
    session: ClientSession,
  ): Promise<WorkShiftScope> {
    if (requestedScope) {
      if (
        PermissionGuard.hasWorkScheduleScopeGrant(
          actor,
          requestedScope,
        )
      ) {
        return requestedScope;
      }

      throw new WorkSchedulePermissionScopeError(
        `Scope ${requestedScope} is not authorized for actor`,
      );
    }

    for (const candidate of [
      "self",
      "team",
      "department",
    ] as const) {
      if (
        !PermissionGuard.hasWorkScheduleScopeGrant(
          actor,
          candidate,
        )
      ) {
        continue;
      }

      try {
        await this.assertScopeAccessForSubject(
          actor,
          candidate,
          subject,
          session,
        );
        return candidate;
      } catch (error) {
        if (
          !(
            error instanceof
            WorkSchedulePermissionScopeError
          )
        ) {
          throw error;
        }
      }
    }

    if (
      PermissionGuard.hasWorkScheduleScopeGrant(
        actor,
        "global",
      )
    ) {
      return "global";
    }

    throw new WorkSchedulePermissionScopeError(
      "scope could not be resolved for actor and target subject",
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

  private async requireWorkShift(
    workShiftId: string,
    session: ClientSession,
  ): Promise<WorkShiftRecord> {
    const workShift =
      await this.repository.findById(
        workShiftId,
        session,
      );

    if (!workShift) {
      throw new WorkScheduleNotFoundError(
        workShiftId,
      );
    }

    return workShift;
  }

  private async assertSubjectEligibility(
    subject: NormalizedSubjectReference,
    session: ClientSession,
  ): Promise<void> {
    switch (subject.subjectKind) {
      case "EMPLOYMENT_PROFILE": {
        const employmentProfileId =
          subject.subjectEmploymentProfileId as string;
        const employmentProfile =
          await this.employmentProfileReadonlyAccess.findById(
            employmentProfileId,
            session,
          );

        if (!employmentProfile) {
          throw new WorkScheduleInvalidSubjectReferenceError(
            `Employment profile subject does not exist: ${employmentProfileId}`,
          );
        }

        if (
          employmentProfile.employmentStatus !==
          "ACTIVE"
        ) {
          throw new WorkScheduleInvalidSubjectReferenceError(
            `Employment profile subject must be ACTIVE: ${employmentProfileId}`,
          );
        }

        return;
      }

      case "TALENT": {
        const talentId =
          subject.subjectTalentId as string;
        const talent =
          await this.talentReadonlyAccess.findById(
            talentId,
            session,
          );

        if (!talent) {
          throw new WorkScheduleInvalidSubjectReferenceError(
            `Talent subject does not exist: ${talentId}`,
          );
        }

        if (
          talent.operationalStatus !== "ACTIVE"
        ) {
          throw new WorkScheduleInvalidSubjectReferenceError(
            `Talent subject must be ACTIVE: ${talentId}`,
          );
        }

        return;
      }

      case "TALENT_GROUP": {
        const talentGroupId =
          subject.subjectTalentGroupId as string;
        const talentGroup =
          await this.talentGroupReadonlyAccess.findById(
            talentGroupId,
            session,
          );

        if (!talentGroup) {
          throw new WorkScheduleInvalidSubjectReferenceError(
            `Talent group subject does not exist: ${talentGroupId}`,
          );
        }

        if (talentGroup.status !== "ACTIVE") {
          throw new WorkScheduleInvalidSubjectReferenceError(
            `Talent group subject must be ACTIVE: ${talentGroupId}`,
          );
        }

        return;
      }
    }
  }

  private async assertStudioResourcesEligible(
    studioResourceIds: readonly string[],
    session: ClientSession,
  ): Promise<void> {
    for (const studioResourceId of studioResourceIds) {
      const studioResource =
        await this.studioResourceReadonlyAccess.findById(
          studioResourceId,
          session,
        );

      if (!studioResource) {
        throw new WorkScheduleInvalidResourceReferenceError(
          `Studio resource does not exist: ${studioResourceId}`,
        );
      }

      if (
        studioResource.operationalStatus !==
        "ACTIVE"
      ) {
        throw new WorkScheduleInvalidResourceReferenceError(
          `Studio resource must be ACTIVE: ${studioResourceId}`,
        );
      }
    }
  }

  private async assertNoOverlapConflicts(params: {
    readonly subject: NormalizedSubjectReference;
    readonly studioResourceIds: readonly string[];
    readonly shiftStartAt: number;
    readonly shiftEndAt: number;
    readonly excludeWorkShiftId?: string;
    readonly session: ClientSession;
  }): Promise<void> {
    const subjectOverlap =
      await this.repository.hasActiveOverlappingSubjectShift(
        {
          subjectKind: params.subject.subjectKind,
          subjectEmploymentProfileId:
            params.subject
              .subjectEmploymentProfileId,
          subjectTalentId:
            params.subject.subjectTalentId,
          subjectTalentGroupId:
            params.subject
              .subjectTalentGroupId,
          shiftStartAt: params.shiftStartAt,
          shiftEndAt: params.shiftEndAt,
          excludeWorkShiftId:
            params.excludeWorkShiftId,
        },
        params.session,
      );

    if (subjectOverlap) {
      throw new WorkScheduleOverlapConflictError(
        "Subject overlap conflict detected with another ACTIVE work shift",
      );
    }

    await this.assertNoResourceOverlapConflicts({
      studioResourceIds:
        params.studioResourceIds,
      shiftStartAt: params.shiftStartAt,
      shiftEndAt: params.shiftEndAt,
      excludeWorkShiftId:
        params.excludeWorkShiftId,
      session: params.session,
    });
  }

  private async assertNoResourceOverlapConflicts(params: {
    readonly studioResourceIds: readonly string[];
    readonly shiftStartAt: number;
    readonly shiftEndAt: number;
    readonly excludeWorkShiftId?: string;
    readonly session: ClientSession;
  }): Promise<void> {
    const resourceOverlap =
      await this.repository.hasActiveOverlappingResourceShift(
        {
          studioResourceIds:
            params.studioResourceIds,
          shiftStartAt: params.shiftStartAt,
          shiftEndAt: params.shiftEndAt,
          excludeWorkShiftId:
            params.excludeWorkShiftId,
        },
        params.session,
      );

    if (resourceOverlap) {
      throw new WorkScheduleOverlapConflictError(
        "Studio resource overlap conflict detected with another ACTIVE work shift",
      );
    }
  }

  private async assertScopeAccessForSubject(
    actor: Actor,
    scope: WorkShiftScope,
    subject: NormalizedSubjectReference,
    session: ClientSession,
  ): Promise<void> {
    if (scope === "global") {
      return;
    }

    if (
      subject.subjectKind !== "EMPLOYMENT_PROFILE" ||
      !subject.subjectEmploymentProfileId
    ) {
      throw new WorkSchedulePermissionScopeError(
        "Non-global scope cannot create or mutate TALENT/TALENT_GROUP subject shifts in Phase 1",
      );
    }

    const actorProfile =
      await this.requireActorLinkedEmploymentProfile(
        actor.id,
        session,
      );
    const targetProfile =
      await this.employmentProfileReadonlyAccess.findById(
        subject.subjectEmploymentProfileId,
        session,
      );

    if (!targetProfile) {
      throw new WorkSchedulePermissionScopeError(
        "Scope resolution target employment profile is missing",
      );
    }

    switch (scope) {
      case "self":
        if (targetProfile.id === actorProfile.id) {
          return;
        }
        break;

      case "team":
        if (
          targetProfile.managerEmploymentProfileId ===
          actorProfile.id
        ) {
          return;
        }
        break;

      case "department":
        if (
          targetProfile.orgUnitId ===
          actorProfile.orgUnitId
        ) {
          return;
        }
        break;
    }

    throw new WorkSchedulePermissionScopeError(
      `Scope ${scope} does not allow mutation for the target subject`,
    );
  }

  private async requireActorLinkedEmploymentProfile(
    actorId: string,
    session: ClientSession,
  ) {
    const actorProfile =
      await this.employmentProfileReadonlyAccess.findByLinkedUserId(
        actorId,
        session,
      );

    if (!actorProfile) {
      throw new WorkSchedulePermissionScopeError(
        "Actor-linked employment profile is required for self/team/department scope",
      );
    }

    return actorProfile;
  }

  private async recordAudit(params: {
    readonly actor: Actor;
    readonly permission: PermissionContract;
    readonly workShiftId: string;
    readonly mutationType: AuthoritativeAdminMutationIdentity;
    readonly metadata: Readonly<
      Record<string, unknown>
    >;
    readonly session: ClientSession;
  }): Promise<void> {
    await this.audit.record(
      params.actor,
      params.permission,
      params.workShiftId,
      {
        mutationType: params.mutationType,
        targetId: params.workShiftId,
        targetType: "work-shift",
        actorId: params.actor.id,
        ...params.metadata,
      },
      params.session,
    );
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
            classifyWorkScheduleMutationFailure(
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
    metadata: Readonly<
      Record<string, unknown>
    >,
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
  command: CreateWorkShiftCommand,
): NormalizedCreateCommand {
  const subject = normalizeSubjectReference({
    subjectKind: command.subjectKind,
    subjectEmploymentProfileId:
      command.subjectEmploymentProfileId,
    subjectTalentId:
      command.subjectTalentId,
    subjectTalentGroupId:
      command.subjectTalentGroupId,
    subjectKindFieldName: "subjectKind",
  });
  const shiftStartAt = normalizeTimestamp(
    command.shiftStartAt,
    "shiftStartAt",
  );
  const shiftEndAt = normalizeTimestamp(
    command.shiftEndAt,
    "shiftEndAt",
  );
  assertValidShiftWindow(
    shiftStartAt,
    shiftEndAt,
  );
  const title = normalizeRequiredText(
    command.title,
    "title",
  );

  return {
    shiftCode: normalizeOptionalCreateShiftCode(
      command.shiftCode,
      "shiftCode",
    ),
    title,
    normalizedTitle:
      canonicalizeSearchToken(title),
    subject,
    studioResourceIds:
      normalizeStudioResourceIds(
        command.studioResourceIds,
        "studioResourceIds",
        true,
      ),
    shiftStartAt,
    shiftEndAt,
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

function normalizeUpdateCoreCommand(
  command: UpdateWorkShiftCoreCommand,
): NormalizedUpdateCoreCommand {
  return {
    workShiftId: normalizeRequiredText(
      command.workShiftId,
      "workShiftId",
    ),
    title: normalizeOptionalNonNullableText(
      command.title,
      "title",
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

function normalizeRescheduleCommand(
  command: RescheduleWorkShiftCommand,
): NormalizedRescheduleCommand {
  const newShiftStartAt = normalizeTimestamp(
    command.newShiftStartAt,
    "newShiftStartAt",
  );
  const newShiftEndAt = normalizeTimestamp(
    command.newShiftEndAt,
    "newShiftEndAt",
  );
  assertValidShiftWindow(
    newShiftStartAt,
    newShiftEndAt,
  );

  return {
    workShiftId: normalizeRequiredText(
      command.workShiftId,
      "workShiftId",
    ),
    newShiftStartAt,
    newShiftEndAt,
    requestedScope: parseRequestedScope(
      command.scope,
    ),
  };
}

function normalizeReassignSubjectCommand(
  command: ReassignWorkShiftSubjectCommand,
): NormalizedReassignSubjectCommand {
  return {
    workShiftId: normalizeRequiredText(
      command.workShiftId,
      "workShiftId",
    ),
    subject: normalizeSubjectReference({
      subjectKind: command.newSubjectKind,
      subjectEmploymentProfileId:
        command.newSubjectEmploymentProfileId,
      subjectTalentId:
        command.newSubjectTalentId,
      subjectTalentGroupId:
        command.newSubjectTalentGroupId,
      subjectKindFieldName:
        "newSubjectKind",
    }),
    requestedScope: parseRequestedScope(
      command.scope,
    ),
  };
}

function normalizeUpdateResourcesCommand(
  command: UpdateWorkShiftResourcesCommand,
): NormalizedUpdateResourcesCommand {
  return {
    workShiftId: normalizeRequiredText(
      command.workShiftId,
      "workShiftId",
    ),
    newStudioResourceIds:
      normalizeStudioResourceIds(
        command.newStudioResourceIds,
        "newStudioResourceIds",
        false,
      ),
    requestedScope: parseRequestedScope(
      command.scope,
    ),
  };
}

function normalizeLifecycleCommand(
  command:
    | CancelWorkShiftCommand
    | ArchiveWorkShiftCommand,
): NormalizedLifecycleCommand {
  return {
    workShiftId: normalizeRequiredText(
      command.workShiftId,
      "workShiftId",
    ),
    requestedScope: parseRequestedScope(
      command.scope,
    ),
  };
}

function buildWorkShiftCorePatch(params: {
  readonly current: WorkShiftRecord;
  readonly workShiftId: string;
  readonly title?: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}): UpdateWorkShiftCoreInput {
  const patch: {
    workShiftId: string;
    updatedAt: number;
    title?: string;
    normalizedTitle?: string;
    description?: string | null;
    externalRef?: string | null;
  } = {
    workShiftId: params.workShiftId,
    updatedAt: Date.now(),
  };

  if (
    params.title !== undefined &&
    params.title !== params.current.title
  ) {
    patch.title = params.title;
    patch.normalizedTitle =
      canonicalizeSearchToken(params.title);
  }

  if (
    params.description !== undefined &&
    params.description !==
      params.current.description
  ) {
    patch.description =
      params.description;
  }

  if (
    params.externalRef !== undefined &&
    params.externalRef !==
      params.current.externalRef
  ) {
    patch.externalRef =
      params.externalRef;
  }

  return patch;
}

function summarizeChangedCoreFields(
  patch: UpdateWorkShiftCoreInput,
): readonly string[] {
  const changedFields: string[] = [];

  if (patch.title !== undefined) {
    changedFields.push("title");
  }

  if (patch.description !== undefined) {
    changedFields.push("description");
  }

  if (patch.externalRef !== undefined) {
    changedFields.push("externalRef");
  }

  return changedFields;
}

function normalizeSubjectReference(input: {
  readonly subjectKind: unknown;
  readonly subjectEmploymentProfileId:
    | unknown
    | undefined;
  readonly subjectTalentId: unknown | undefined;
  readonly subjectTalentGroupId:
    | unknown
    | undefined;
  readonly subjectKindFieldName: string;
}): NormalizedSubjectReference {
  const subjectKind =
    normalizeSubjectKind(
      input.subjectKind,
      input.subjectKindFieldName,
    );
  const subjectEmploymentProfileId =
    normalizeOptionalNullableId(
      input.subjectEmploymentProfileId,
      "subjectEmploymentProfileId",
    );
  const subjectTalentId =
    normalizeOptionalNullableId(
      input.subjectTalentId,
      "subjectTalentId",
    );
  const subjectTalentGroupId =
    normalizeOptionalNullableId(
      input.subjectTalentGroupId,
      "subjectTalentGroupId",
    );

  if (subjectKind === "EMPLOYMENT_PROFILE") {
    if (
      !subjectEmploymentProfileId ||
      subjectTalentId !== null ||
      subjectTalentGroupId !== null
    ) {
      throw new WorkScheduleValidationError(
        "subjectKind EMPLOYMENT_PROFILE requires subjectEmploymentProfileId and forbids other subject references",
      );
    }

    return {
      subjectKind,
      subjectEmploymentProfileId,
      subjectTalentId: null,
      subjectTalentGroupId: null,
    };
  }

  if (subjectKind === "TALENT") {
    if (
      !subjectTalentId ||
      subjectEmploymentProfileId !== null ||
      subjectTalentGroupId !== null
    ) {
      throw new WorkScheduleValidationError(
        "subjectKind TALENT requires subjectTalentId and forbids other subject references",
      );
    }

    return {
      subjectKind,
      subjectEmploymentProfileId: null,
      subjectTalentId,
      subjectTalentGroupId: null,
    };
  }

  if (
    !subjectTalentGroupId ||
    subjectEmploymentProfileId !== null ||
    subjectTalentId !== null
  ) {
    throw new WorkScheduleValidationError(
      "subjectKind TALENT_GROUP requires subjectTalentGroupId and forbids other subject references",
    );
  }

  return {
    subjectKind,
    subjectEmploymentProfileId: null,
    subjectTalentId: null,
    subjectTalentGroupId,
  };
}

function normalizeSubjectKind(
  value: unknown,
  field: string,
): WorkShiftSubjectKind {
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `${field} must be one of ${WORK_SHIFT_SUBJECT_KINDS.join(", ")}`,
    );
  }

  const normalized = value
    .trim()
    .toUpperCase();

  if (
    WORK_SHIFT_SUBJECT_KINDS.includes(
      normalized as WorkShiftSubjectKind,
    )
  ) {
    return normalized as WorkShiftSubjectKind;
  }

  throw new WorkScheduleValidationError(
    `${field} must be one of ${WORK_SHIFT_SUBJECT_KINDS.join(", ")}`,
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

function normalizeOptionalNullableId(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return normalizeRequiredText(value, field);
}

function normalizeTimestamp(
  value: unknown,
  field: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value)
  ) {
    throw new WorkScheduleValidationError(
      `${field} must be an integer UTC timestamp`,
    );
  }

  return value;
}

function normalizeStudioResourceIds(
  value: unknown,
  field: string,
  allowUndefined: boolean,
): readonly string[] {
  if (value === undefined) {
    if (allowUndefined) {
      return [];
    }

    throw new WorkScheduleValidationError(
      `${field} must be an array`,
    );
  }

  if (!Array.isArray(value)) {
    throw new WorkScheduleValidationError(
      `${field} must be an array`,
    );
  }

  const normalizedIds = value.map(
    (item, index) =>
      normalizeRequiredText(
        item,
        `${field}[${index}]`,
      ),
  );
  const distinct = new Set(normalizedIds);

  if (distinct.size !== normalizedIds.length) {
    throw new WorkScheduleValidationError(
      `${field} must not contain duplicate values`,
    );
  }

  return [...distinct].sort();
}

function parseRequestedScope(
  value: unknown,
): WorkShiftScope | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `scope must be one of ${WORK_SHIFT_SCOPES.join(", ")}`,
    );
  }

  const normalized = value
    .trim()
    .toLowerCase();

  if (
    WORK_SHIFT_SCOPES.includes(
      normalized as WorkShiftScope,
    )
  ) {
    return normalized as WorkShiftScope;
  }

  throw new WorkScheduleValidationError(
    `scope must be one of ${WORK_SHIFT_SCOPES.join(", ")}`,
  );
}

function assertValidShiftWindow(
  shiftStartAt: number,
  shiftEndAt: number,
): void {
  if (shiftEndAt <= shiftStartAt) {
    throw new WorkScheduleValidationError(
      "shiftEndAt must be strictly greater than shiftStartAt",
    );
  }
}

function assertActiveForStructuralMutation(
  current: WorkShiftRecord,
  operation: string,
): void {
  if (current.status === "ACTIVE") {
    return;
  }

  throw new WorkScheduleStateError(
    `${operation} requires status ACTIVE, received ${current.status}`,
  );
}

function toSubjectReference(
  record: WorkShiftRecord,
): NormalizedSubjectReference {
  return {
    subjectKind: record.subjectKind,
    subjectEmploymentProfileId:
      record.subjectEmploymentProfileId,
    subjectTalentId:
      record.subjectTalentId,
    subjectTalentGroupId:
      record.subjectTalentGroupId,
  };
}

function areSubjectsEqual(
  left: NormalizedSubjectReference,
  right: NormalizedSubjectReference,
): boolean {
  return (
    left.subjectKind === right.subjectKind &&
    left.subjectEmploymentProfileId ===
      right.subjectEmploymentProfileId &&
    left.subjectTalentId ===
      right.subjectTalentId &&
    left.subjectTalentGroupId ===
      right.subjectTalentGroupId
  );
}

function areCanonicalResourceSetsEqual(
  left: readonly string[],
  right: readonly string[],
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

function assertAdminActorType(
  actor: Actor,
): void {
  if (actor.type === "admin") {
    return;
  }

  throw new SystemInvariantError(
    "PERMISSION_DENIED",
    `Work schedule access requires actor.type admin, received ${actor.type}`,
  );
}

function toWorkShiftMutationView(
  record: WorkShiftRecord,
): WorkShiftMutationView {
  return {
    id: record.id,
    shiftCode: record.shiftCode,
    title: record.title,
    subjectKind: record.subjectKind,
    subjectEmploymentProfileId:
      record.subjectEmploymentProfileId,
    subjectTalentId:
      record.subjectTalentId,
    subjectTalentGroupId:
      record.subjectTalentGroupId,
    studioResourceIds: [
      ...record.studioResourceIds,
    ],
    status: record.status,
    shiftStartAt: record.shiftStartAt,
    shiftEndAt: record.shiftEndAt,
    description: record.description,
    externalRef: record.externalRef,
    sourceType: record.sourceType,
    sourceRosterId: record.sourceRosterId,
    sourcePatternId: record.sourcePatternId,
    sourceExceptionId: record.sourceExceptionId,
    sourceGenerationRunId:
      record.sourceGenerationRunId,
    sourceRosterMonth: record.sourceRosterMonth,
    sourceDepartmentOrgUnitId:
      record.sourceDepartmentOrgUnitId,
    sourceRosterLocalDate:
      record.sourceRosterLocalDate,
    sourceRosterSlotKey: record.sourceRosterSlotKey,
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

function classifyWorkScheduleMutationFailure(
  error: unknown,
): WorkScheduleFailureClassification {
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

  if (
    error instanceof
    WorkScheduleOverlapConflictError
  ) {
    return "overlap_conflict";
  }

  if (
    error instanceof
    WorkSchedulePermissionScopeError
  ) {
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

function normalizeOptionalCreateShiftCode(
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
