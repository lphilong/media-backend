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
  EventAssignmentConflictError,
  EventAssignmentInvalidAssignmentReferenceError,
  EventAssignmentInvalidPlatformReferenceError,
  EventAssignmentInvalidResourceReferenceError,
  EventAssignmentNotFoundError,
  EventAssignmentOverlapConflictError,
  EventAssignmentPermissionScopeError,
  EventAssignmentStateError,
  EventAssignmentValidationError,
} from "@modules/event-assignment/domain/event-assignment.errors";
import { EventAssignmentEmploymentProfileReadonlyAccess } from "@modules/event-assignment/domain/event-assignment-employment-profile-readonly-access";
import { EventAssignmentPlatformAccountReadonlyAccess } from "@modules/event-assignment/domain/event-assignment-platform-account-readonly-access";
import {
  EventAssignmentReferenceInput,
  EventAssignmentRepository,
  EventOverlapAssignmentCheckInput,
  EventOverlapPlatformCheckInput,
  EventOverlapResourceCheckInput,
  MarkAssignmentsRemovedInput,
  ReplaceEventPlatformAccountsInput,
  ReplaceEventStudioResourcesInput,
  RescheduleEventInput,
  UpdateEventCoreInput,
} from "@modules/event-assignment/domain/event-assignment.repository";
import { EventAssignmentStudioResourceReadonlyAccess } from "@modules/event-assignment/domain/event-assignment-studio-resource-readonly-access";
import { EventAssignmentTalentReadonlyAccess } from "@modules/event-assignment/domain/event-assignment-talent-readonly-access";
import { EventAssignmentTalentGroupReadonlyAccess } from "@modules/event-assignment/domain/event-assignment-talent-group-readonly-access";
import {
  EVENT_ASSIGNMENT_KINDS,
  EventAssignmentKind,
  EventAssignmentRecord,
  EventMutationView,
  EventRecord,
} from "@modules/event-assignment/domain/event-assignment.types";
import {
  ArchiveEventCommand,
  CancelEventCommand,
  CompleteEventCommand,
  CreateEventCommand,
  EventAssignmentInput,
  EventMutationResult,
  ReplaceEventAssignmentsCommand,
  RescheduleEventCommand,
  StartEventCommand,
  UpdateEventCoreCommand,
  UpdateEventPlatformAccountsCommand,
  UpdateEventStudioResourcesCommand,
} from "@modules/event-assignment/shared/event-assignment.contracts";

type EventAssignmentMutationFailureClassification =
  | "validation"
  | "conflict"
  | "not_found"
  | "state_error"
  | "invalid_assignment_reference"
  | "invalid_resource_reference"
  | "invalid_platform_reference"
  | "overlap_conflict"
  | "permission_scope"
  | "invariant"
  | "unknown";

interface NormalizedAssignmentReference
  extends EventAssignmentReferenceInput {}

interface NormalizedCreateCommand {
  readonly eventCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly assignments: readonly NormalizedAssignmentReference[];
  readonly studioResourceIds: readonly string[];
  readonly platformAccountIds: readonly string[];
  readonly eventStartAt: number;
  readonly eventEndAt: number;
  readonly description: string | null;
  readonly externalRef: string | null;
}

interface NormalizedUpdateCoreCommand {
  readonly eventId: string;
  readonly title?: string;
  readonly normalizedTitle?: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

interface NormalizedRescheduleCommand {
  readonly eventId: string;
  readonly newEventStartAt: number;
  readonly newEventEndAt: number;
}

interface NormalizedReplaceAssignmentsCommand {
  readonly eventId: string;
  readonly replacementAssignments: readonly NormalizedAssignmentReference[];
}

interface NormalizedUpdateStudioResourcesCommand {
  readonly eventId: string;
  readonly newStudioResourceIds: readonly string[];
}

interface NormalizedUpdatePlatformAccountsCommand {
  readonly eventId: string;
  readonly newPlatformAccountIds: readonly string[];
}

interface NormalizedLifecycleCommand {
  readonly eventId: string;
}

export class EventAssignmentAdminService {
  constructor(
    private readonly repository: EventAssignmentRepository,
    private readonly employmentProfileReadonlyAccess: EventAssignmentEmploymentProfileReadonlyAccess,
    private readonly talentReadonlyAccess: EventAssignmentTalentReadonlyAccess,
    private readonly talentGroupReadonlyAccess: EventAssignmentTalentGroupReadonlyAccess,
    private readonly studioResourceReadonlyAccess: EventAssignmentStudioResourceReadonlyAccess,
    private readonly platformAccountReadonlyAccess: EventAssignmentPlatformAccountReadonlyAccess,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly logger: StructuredLogger = createStructuredLogger(),
  ) {}

  async createEvent(
    actor: Actor,
    command: CreateEventCommand,
  ): Promise<EventMutationResult> {
    const operation = "event-assignment.create";
    const permission = this.assertPermission(
      actor,
      Permission.EVENT_CREATE,
    );
    const input = normalizeCreateCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        eventCode: input.eventCode,
        assignmentCount: input.assignments.length,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(actor);
        const existingByCode =
          await this.repository.findEventByEventCode(
            input.eventCode,
            session,
          );

        if (existingByCode) {
          throw new EventAssignmentConflictError(
            `Event code already exists: ${input.eventCode}`,
          );
        }

        assertHasActiveAssignments(
          input.assignments,
          "assignments",
        );
        await this.assertAssignmentsEligible(
          input.assignments,
          session,
        );
        await this.assertStudioResourcesEligible(
          input.studioResourceIds,
          session,
        );
        await this.assertPlatformAccountsEligible(
          input.platformAccountIds,
          session,
        );

        await this.assertNoAssignmentOverlapConflicts(
          {
            assignments: input.assignments,
            eventStartAt: input.eventStartAt,
            eventEndAt: input.eventEndAt,
            session,
          },
        );

        await this.assertNoResourceOverlapConflicts({
          studioResourceIds: input.studioResourceIds,
          eventStartAt: input.eventStartAt,
          eventEndAt: input.eventEndAt,
          session,
        });

        await this.assertNoPlatformOverlapConflicts({
          platformAccountIds:
            input.platformAccountIds,
          eventStartAt: input.eventStartAt,
          eventEndAt: input.eventEndAt,
          session,
        });

        const now = Date.now();
        const eventRecord: EventRecord = {
          id: crypto.randomUUID(),
          eventCode: input.eventCode,
          title: input.title,
          normalizedTitle: input.normalizedTitle,
          studioResourceIds: [
            ...input.studioResourceIds,
          ],
          platformAccountIds: [
            ...input.platformAccountIds,
          ],
          status: "SCHEDULED",
          eventStartAt: input.eventStartAt,
          eventEndAt: input.eventEndAt,
          description: input.description,
          externalRef: input.externalRef,
          createdAt: now,
          updatedAt: now,
        };

        const assignments =
          input.assignments.map((assignment) => ({
            id: crypto.randomUUID(),
            eventId: eventRecord.id,
            assignmentKind:
              assignment.assignmentKind,
            assignmentEmploymentProfileId:
              assignment.assignmentEmploymentProfileId,
            assignmentTalentId:
              assignment.assignmentTalentId,
            assignmentTalentGroupId:
              assignment.assignmentTalentGroupId,
            assignmentStatus: "ACTIVE" as const,
            createdAt: now,
            updatedAt: now,
            removedAt: null,
          }));

        let createdEvent: EventRecord;

        try {
          createdEvent = await this.repository.insertEvent(
            eventRecord,
            session,
          );
          await this.repository.insertAssignments(
            assignments,
            session,
          );
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            throw new EventAssignmentConflictError(
              "Event conflict detected on create",
            );
          }

          throw error;
        }

        await this.recordAudit({
          actor,
          permission,
          eventId: createdEvent.id,
          mutationType: operation,
          metadata: {
            eventCode: createdEvent.eventCode,
            assignmentReferences:
              summarizeAssignmentReferences(
                input.assignments,
              ),
            studioResourceIds: [
              ...createdEvent.studioResourceIds,
            ],
            platformAccountIds: [
              ...createdEvent.platformAccountIds,
            ],
            eventStartAt: createdEvent.eventStartAt,
            eventEndAt: createdEvent.eventEndAt,
            effectiveScope: scope,
          },
          session,
        });

        return toEventMutationView(createdEvent);
      },
      (result) => ({
        eventId: result.id,
        status: result.status,
      }),
    );
  }

  async updateEventCore(
    actor: Actor,
    command: UpdateEventCoreCommand,
  ): Promise<EventMutationResult> {
    const operation = "event-assignment.update-core";
    const permission = this.assertPermission(
      actor,
      Permission.EVENT_UPDATE,
    );
    const input = normalizeUpdateCoreCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        eventId: input.eventId,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current = await this.requireEvent(
          input.eventId,
          session,
        );

        assertScheduledForStructuralMutation(
          current,
          operation,
        );

        const patch = buildUpdateEventCoreInput({
          current,
          command: input,
        });

        if (patch.changedFields.length === 0) {
          throw new EventAssignmentValidationError(
            "At least one changed core field is required",
          );
        }

        const updated =
          await this.repository.updateEventCore(
            patch.update,
            session,
          );

        if (!updated) {
          throw new EventAssignmentConflictError(
            `Failed to update event core: ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          eventId: updated.id,
          mutationType: operation,
          metadata: {
            changedFields: patch.changedFields,
            effectiveScope: scope,
          },
          session,
        });

        return toEventMutationView(updated);
      },
      (result) => ({
        eventId: result.id,
        status: result.status,
      }),
    );
  }

  async rescheduleEvent(
    actor: Actor,
    command: RescheduleEventCommand,
  ): Promise<EventMutationResult> {
    const operation = "event-assignment.reschedule";
    const permission = this.assertPermission(
      actor,
      Permission.EVENT_UPDATE,
    );
    const input = normalizeRescheduleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        eventId: input.eventId,
      },
      async (session, controls) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current = await this.requireEvent(
          input.eventId,
          session,
        );

        assertScheduledForStructuralMutation(
          current,
          operation,
        );

        const activeAssignments =
          await this.repository.listAssignmentsByEventId(
            current.id,
            "ACTIVE",
            session,
          );

        await this.assertNoAssignmentOverlapConflicts({
          assignments: activeAssignments,
          eventStartAt: input.newEventStartAt,
          eventEndAt: input.newEventEndAt,
          excludeEventId: current.id,
          session,
        });

        await this.assertNoResourceOverlapConflicts({
          studioResourceIds:
            current.studioResourceIds,
          eventStartAt: input.newEventStartAt,
          eventEndAt: input.newEventEndAt,
          excludeEventId: current.id,
          session,
        });

        await this.assertNoPlatformOverlapConflicts({
          platformAccountIds:
            current.platformAccountIds,
          eventStartAt: input.newEventStartAt,
          eventEndAt: input.newEventEndAt,
          excludeEventId: current.id,
          session,
        });

        if (
          current.eventStartAt ===
            input.newEventStartAt &&
          current.eventEndAt ===
            input.newEventEndAt
        ) {
          controls.markExplicitNoOpSuccess();
          return toEventMutationView(current);
        }

        const updateInput: RescheduleEventInput = {
          eventId: current.id,
          eventStartAt: input.newEventStartAt,
          eventEndAt: input.newEventEndAt,
          updatedAt: Date.now(),
        };
        const updated =
          await this.repository.rescheduleEvent(
            updateInput,
            session,
          );

        if (!updated) {
          throw new EventAssignmentConflictError(
            `Failed to reschedule event: ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          eventId: updated.id,
          mutationType: operation,
          metadata: {
            previousEventStartAt:
              current.eventStartAt,
            previousEventEndAt:
              current.eventEndAt,
            newEventStartAt: updated.eventStartAt,
            newEventEndAt: updated.eventEndAt,
            effectiveScope: scope,
          },
          session,
        });

        return toEventMutationView(updated);
      },
      (result) => ({
        eventId: result.id,
        status: result.status,
      }),
    );
  }

  async replaceEventAssignments(
    actor: Actor,
    command: ReplaceEventAssignmentsCommand,
  ): Promise<EventMutationResult> {
    const operation =
      "event-assignment.replace-assignments";
    const permission = this.assertPermission(
      actor,
      Permission.EVENT_MANAGE_ASSIGNMENTS,
    );
    const input =
      normalizeReplaceAssignmentsCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        eventId: input.eventId,
        assignmentCount:
          input.replacementAssignments.length,
      },
      async (session, controls) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current = await this.requireEvent(
          input.eventId,
          session,
        );

        assertScheduledForStructuralMutation(
          current,
          operation,
        );

        assertHasActiveAssignments(
          input.replacementAssignments,
          "replacementAssignments",
        );
        await this.assertAssignmentsEligible(
          input.replacementAssignments,
          session,
        );

        await this.assertNoAssignmentOverlapConflicts({
          assignments:
            input.replacementAssignments,
          eventStartAt: current.eventStartAt,
          eventEndAt: current.eventEndAt,
          excludeEventId: current.id,
          session,
        });

        await this.assertNoResourceOverlapConflicts({
          studioResourceIds:
            current.studioResourceIds,
          eventStartAt: current.eventStartAt,
          eventEndAt: current.eventEndAt,
          excludeEventId: current.id,
          session,
        });

        await this.assertNoPlatformOverlapConflicts({
          platformAccountIds:
            current.platformAccountIds,
          eventStartAt: current.eventStartAt,
          eventEndAt: current.eventEndAt,
          excludeEventId: current.id,
          session,
        });

        const currentActiveAssignments =
          await this.repository.listAssignmentsByEventId(
            current.id,
            "ACTIVE",
            session,
          );

        if (
          areCanonicalAssignmentSetsEqual(
            currentActiveAssignments,
            input.replacementAssignments,
          )
        ) {
          controls.markExplicitNoOpSuccess();
          return toEventMutationView(current);
        }

        const now = Date.now();
        const currentBySignature = new Map(
          currentActiveAssignments.map((assignment) => [
            buildAssignmentSignature(assignment),
            assignment,
          ]),
        );
        const replacementSignatureSet = new Set(
          input.replacementAssignments.map(
            buildAssignmentSignature,
          ),
        );

        const assignmentIdsToRemove =
          currentActiveAssignments
            .filter(
              (assignment) =>
                !replacementSignatureSet.has(
                  buildAssignmentSignature(
                    assignment,
                  ),
                ),
            )
            .map((assignment) => assignment.id);

        const assignmentsToCreate: EventAssignmentRecord[] =
          [];

        for (const assignment of input.replacementAssignments) {
          const signature =
            buildAssignmentSignature(assignment);

          if (currentBySignature.has(signature)) {
            continue;
          }

          assignmentsToCreate.push({
            id: crypto.randomUUID(),
            eventId: current.id,
            assignmentKind:
              assignment.assignmentKind,
            assignmentEmploymentProfileId:
              assignment.assignmentEmploymentProfileId,
            assignmentTalentId:
              assignment.assignmentTalentId,
            assignmentTalentGroupId:
              assignment.assignmentTalentGroupId,
            assignmentStatus: "ACTIVE",
            createdAt: now,
            updatedAt: now,
            removedAt: null,
          });
        }

        if (assignmentIdsToRemove.length > 0) {
          const removeInput: MarkAssignmentsRemovedInput =
            {
              eventId: current.id,
              assignmentIds: assignmentIdsToRemove,
              removedAt: now,
              updatedAt: now,
            };

          await this.repository.markAssignmentsRemoved(
            removeInput,
            session,
          );
        }

        if (assignmentsToCreate.length > 0) {
          await this.repository.insertAssignments(
            assignmentsToCreate,
            session,
          );
        }

        const touched = await this.repository.touchEvent(
          current.id,
          now,
          session,
        );

        if (!touched) {
          throw new EventAssignmentConflictError(
            `Failed to replace event assignments: ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          eventId: touched.id,
          mutationType: operation,
          metadata: {
            previousActiveAssignments:
              summarizeAssignmentReferences(
                currentActiveAssignments,
              ),
            nextActiveAssignments:
              summarizeAssignmentReferences(
                input.replacementAssignments,
              ),
            effectiveScope: scope,
          },
          session,
        });

        return toEventMutationView(touched);
      },
      (result) => ({
        eventId: result.id,
        status: result.status,
      }),
    );
  }

  async updateEventStudioResources(
    actor: Actor,
    command: UpdateEventStudioResourcesCommand,
  ): Promise<EventMutationResult> {
    const operation =
      "event-assignment.update-resources";
    const permission = this.assertPermission(
      actor,
      Permission.EVENT_UPDATE,
    );
    const input =
      normalizeUpdateStudioResourcesCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        eventId: input.eventId,
        resourceCount:
          input.newStudioResourceIds.length,
      },
      async (session, controls) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current = await this.requireEvent(
          input.eventId,
          session,
        );

        assertScheduledForStructuralMutation(
          current,
          operation,
        );

        await this.assertStudioResourcesEligible(
          input.newStudioResourceIds,
          session,
        );
        await this.assertNoResourceOverlapConflicts({
          studioResourceIds:
            input.newStudioResourceIds,
          eventStartAt: current.eventStartAt,
          eventEndAt: current.eventEndAt,
          excludeEventId: current.id,
          session,
        });

        if (
          areCanonicalIdSetsEqual(
            current.studioResourceIds,
            input.newStudioResourceIds,
          )
        ) {
          controls.markExplicitNoOpSuccess();
          return toEventMutationView(current);
        }

        const updateInput: ReplaceEventStudioResourcesInput =
          {
            eventId: current.id,
            studioResourceIds:
              input.newStudioResourceIds,
            updatedAt: Date.now(),
          };

        const updated =
          await this.repository.replaceEventStudioResources(
            updateInput,
            session,
          );

        if (!updated) {
          throw new EventAssignmentConflictError(
            `Failed to update event studio resources: ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          eventId: updated.id,
          mutationType: operation,
          metadata: {
            previousStudioResourceIds: [
              ...current.studioResourceIds,
            ],
            newStudioResourceIds: [
              ...updated.studioResourceIds,
            ],
            effectiveScope: scope,
          },
          session,
        });

        return toEventMutationView(updated);
      },
      (result) => ({
        eventId: result.id,
        status: result.status,
      }),
    );
  }

  async updateEventPlatformAccounts(
    actor: Actor,
    command: UpdateEventPlatformAccountsCommand,
  ): Promise<EventMutationResult> {
    const operation =
      "event-assignment.update-platform-accounts";
    const permission = this.assertPermission(
      actor,
      Permission.EVENT_UPDATE,
    );
    const input =
      normalizeUpdatePlatformAccountsCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        eventId: input.eventId,
        platformCount:
          input.newPlatformAccountIds.length,
      },
      async (session, controls) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current = await this.requireEvent(
          input.eventId,
          session,
        );

        assertScheduledForStructuralMutation(
          current,
          operation,
        );

        await this.assertPlatformAccountsEligible(
          input.newPlatformAccountIds,
          session,
        );
        await this.assertNoPlatformOverlapConflicts({
          platformAccountIds:
            input.newPlatformAccountIds,
          eventStartAt: current.eventStartAt,
          eventEndAt: current.eventEndAt,
          excludeEventId: current.id,
          session,
        });

        if (
          areCanonicalIdSetsEqual(
            current.platformAccountIds,
            input.newPlatformAccountIds,
          )
        ) {
          controls.markExplicitNoOpSuccess();
          return toEventMutationView(current);
        }

        const updateInput: ReplaceEventPlatformAccountsInput =
          {
            eventId: current.id,
            platformAccountIds:
              input.newPlatformAccountIds,
            updatedAt: Date.now(),
          };

        const updated =
          await this.repository.replaceEventPlatformAccounts(
            updateInput,
            session,
          );

        if (!updated) {
          throw new EventAssignmentConflictError(
            `Failed to update event platform accounts: ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          eventId: updated.id,
          mutationType: operation,
          metadata: {
            previousPlatformAccountIds: [
              ...current.platformAccountIds,
            ],
            newPlatformAccountIds: [
              ...updated.platformAccountIds,
            ],
            effectiveScope: scope,
          },
          session,
        });

        return toEventMutationView(updated);
      },
      (result) => ({
        eventId: result.id,
        status: result.status,
      }),
    );
  }

  async startEvent(
    actor: Actor,
    command: StartEventCommand,
  ): Promise<EventMutationResult> {
    const operation = "event-assignment.start";
    const permission = this.assertPermission(
      actor,
      Permission.EVENT_MANAGE_LIFECYCLE,
    );
    const input = normalizeLifecycleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        eventId: input.eventId,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current = await this.requireEvent(
          input.eventId,
          session,
        );

        if (current.status !== "SCHEDULED") {
          throw new EventAssignmentStateError(
            `startEvent requires status SCHEDULED, received ${current.status}`,
          );
        }

        await this.assertEventHasActiveAssignments(
          current.id,
          session,
        );

        const updated =
          await this.repository.transitionEventStatus(
            {
              eventId: current.id,
              fromStatuses: ["SCHEDULED"],
              toStatus: "IN_PROGRESS",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new EventAssignmentConflictError(
            `Event state transition conflict for ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          eventId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            effectiveScope: scope,
          },
          session,
        });

        return toEventMutationView(updated);
      },
      (result) => ({
        eventId: result.id,
        status: result.status,
      }),
    );
  }

  async completeEvent(
    actor: Actor,
    command: CompleteEventCommand,
  ): Promise<EventMutationResult> {
    const operation = "event-assignment.complete";
    const permission = this.assertPermission(
      actor,
      Permission.EVENT_MANAGE_LIFECYCLE,
    );
    const input = normalizeLifecycleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        eventId: input.eventId,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current = await this.requireEvent(
          input.eventId,
          session,
        );

        if (current.status !== "IN_PROGRESS") {
          throw new EventAssignmentStateError(
            `completeEvent requires status IN_PROGRESS, received ${current.status}`,
          );
        }

        const updated =
          await this.repository.transitionEventStatus(
            {
              eventId: current.id,
              fromStatuses: ["IN_PROGRESS"],
              toStatus: "COMPLETED",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new EventAssignmentConflictError(
            `Event state transition conflict for ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          eventId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            effectiveScope: scope,
          },
          session,
        });

        return toEventMutationView(updated);
      },
      (result) => ({
        eventId: result.id,
        status: result.status,
      }),
    );
  }

  async cancelEvent(
    actor: Actor,
    command: CancelEventCommand,
  ): Promise<EventMutationResult> {
    const operation = "event-assignment.cancel";
    const permission = this.assertPermission(
      actor,
      Permission.EVENT_MANAGE_LIFECYCLE,
    );
    const input = normalizeLifecycleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        eventId: input.eventId,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current = await this.requireEvent(
          input.eventId,
          session,
        );

        if (
          current.status !== "SCHEDULED" &&
          current.status !== "IN_PROGRESS"
        ) {
          throw new EventAssignmentStateError(
            `cancelEvent requires status SCHEDULED or IN_PROGRESS, received ${current.status}`,
          );
        }

        const updated =
          await this.repository.transitionEventStatus(
            {
              eventId: current.id,
              fromStatuses: [current.status],
              toStatus: "CANCELLED",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new EventAssignmentConflictError(
            `Event state transition conflict for ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          eventId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            effectiveScope: scope,
          },
          session,
        });

        return toEventMutationView(updated);
      },
      (result) => ({
        eventId: result.id,
        status: result.status,
      }),
    );
  }

  async archiveEvent(
    actor: Actor,
    command: ArchiveEventCommand,
  ): Promise<EventMutationResult> {
    const operation = "event-assignment.archive";
    const permission = this.assertPermission(
      actor,
      Permission.EVENT_MANAGE_LIFECYCLE,
    );
    const input = normalizeLifecycleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        eventId: input.eventId,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current = await this.requireEvent(
          input.eventId,
          session,
        );

        if (current.status === "ARCHIVED") {
          throw new EventAssignmentStateError(
            `archiveEvent cannot transition from ARCHIVED for ${current.id}`,
          );
        }

        if (current.status === "IN_PROGRESS") {
          throw new EventAssignmentStateError(
            `archiveEvent cannot transition from IN_PROGRESS for ${current.id}`,
          );
        }

        if (
          current.status === "SCHEDULED" &&
          current.eventEndAt > Date.now()
        ) {
          throw new EventAssignmentStateError(
            `archiveEvent requires a historical SCHEDULED event where eventEndAt is not later than current evaluation time: ${current.id}`,
          );
        }

        if (
          current.status !== "COMPLETED" &&
          current.status !== "CANCELLED" &&
          current.status !== "SCHEDULED"
        ) {
          throw new EventAssignmentStateError(
            `archiveEvent is not allowed from status ${current.status}`,
          );
        }

        const updated =
          await this.repository.transitionEventStatus(
            {
              eventId: current.id,
              fromStatuses: [current.status],
              toStatus: "ARCHIVED",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new EventAssignmentConflictError(
            `Event state transition conflict for ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          eventId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            effectiveScope: scope,
          },
          session,
        });

        return toEventMutationView(updated);
      },
      (result) => ({
        eventId: result.id,
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

  private async requireEvent(
    eventId: string,
    session: ClientSession,
  ): Promise<EventRecord> {
    const event = await this.repository.findEventById(
      eventId,
      session,
    );

    if (!event) {
      throw new EventAssignmentNotFoundError(
        eventId,
      );
    }

    return event;
  }

  private async assertEventHasActiveAssignments(
    eventId: string,
    session: ClientSession,
  ): Promise<void> {
    const activeAssignments =
      await this.repository.listAssignmentsByEventId(
        eventId,
        "ACTIVE",
        session,
      );

    if (activeAssignments.length > 0) {
      return;
    }

    throw new EventAssignmentStateError(
      `Non-archived event must retain at least one ACTIVE assignment: ${eventId}`,
    );
  }

  private async assertAssignmentsEligible(
    assignments: readonly NormalizedAssignmentReference[],
    session: ClientSession,
  ): Promise<void> {
    for (const assignment of assignments) {
      switch (assignment.assignmentKind) {
        case "EMPLOYMENT_PROFILE": {
          const employmentProfileId =
            assignment.assignmentEmploymentProfileId as string;
          const employmentProfile =
            await this.employmentProfileReadonlyAccess.findById(
              employmentProfileId,
              session,
            );

          if (!employmentProfile) {
            throw new EventAssignmentInvalidAssignmentReferenceError(
              `Employment profile assignment reference does not exist: ${employmentProfileId}`,
            );
          }

          if (
            employmentProfile.employmentStatus !==
            "ACTIVE"
          ) {
            throw new EventAssignmentInvalidAssignmentReferenceError(
              `Employment profile assignment reference must be ACTIVE: ${employmentProfileId}`,
            );
          }

          break;
        }

        case "TALENT": {
          const talentId =
            assignment.assignmentTalentId as string;
          const talent =
            await this.talentReadonlyAccess.findById(
              talentId,
              session,
            );

          if (!talent) {
            throw new EventAssignmentInvalidAssignmentReferenceError(
              `Talent assignment reference does not exist: ${talentId}`,
            );
          }

          if (
            talent.operationalStatus !== "ACTIVE"
          ) {
            throw new EventAssignmentInvalidAssignmentReferenceError(
              `Talent assignment reference must be ACTIVE: ${talentId}`,
            );
          }

          break;
        }

        case "TALENT_GROUP": {
          const talentGroupId =
            assignment.assignmentTalentGroupId as string;
          const talentGroup =
            await this.talentGroupReadonlyAccess.findById(
              talentGroupId,
              session,
            );

          if (!talentGroup) {
            throw new EventAssignmentInvalidAssignmentReferenceError(
              `Talent group assignment reference does not exist: ${talentGroupId}`,
            );
          }

          if (talentGroup.status !== "ACTIVE") {
            throw new EventAssignmentInvalidAssignmentReferenceError(
              `Talent group assignment reference must be ACTIVE: ${talentGroupId}`,
            );
          }

          break;
        }
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
        throw new EventAssignmentInvalidResourceReferenceError(
          `Studio resource reference does not exist: ${studioResourceId}`,
        );
      }

      if (
        studioResource.operationalStatus !==
        "ACTIVE"
      ) {
        throw new EventAssignmentInvalidResourceReferenceError(
          `Studio resource reference must be ACTIVE: ${studioResourceId}`,
        );
      }
    }
  }

  private async assertPlatformAccountsEligible(
    platformAccountIds: readonly string[],
    session: ClientSession,
  ): Promise<void> {
    for (const platformAccountId of platformAccountIds) {
      const platformAccount =
        await this.platformAccountReadonlyAccess.findById(
          platformAccountId,
          session,
        );

      if (!platformAccount) {
        throw new EventAssignmentInvalidPlatformReferenceError(
          `Platform account reference does not exist: ${platformAccountId}`,
        );
      }

      if (
        platformAccount.operationalStatus !==
        "ACTIVE"
      ) {
        throw new EventAssignmentInvalidPlatformReferenceError(
          `Platform account reference must be ACTIVE: ${platformAccountId}`,
        );
      }

      if (
        !platformAccount.livestreamEnabled &&
        !platformAccount.contentPublishingEnabled
      ) {
        throw new EventAssignmentInvalidPlatformReferenceError(
          `Platform account reference must have livestreamEnabled or contentPublishingEnabled true: ${platformAccountId}`,
        );
      }
    }
  }

  private async assertNoAssignmentOverlapConflicts(params: {
    readonly assignments:
      | readonly NormalizedAssignmentReference[]
      | readonly EventAssignmentRecord[];
    readonly eventStartAt: number;
    readonly eventEndAt: number;
    readonly excludeEventId?: string;
    readonly session: ClientSession;
  }): Promise<void> {
    const overlapInput:
      EventOverlapAssignmentCheckInput = {
      ...toAssignmentOverlapReferenceBuckets(
        params.assignments,
      ),
      eventStartAt: params.eventStartAt,
      eventEndAt: params.eventEndAt,
      excludeEventId: params.excludeEventId,
    };

    const hasOverlap =
      await this.repository.hasLiveOverlappingAssignmentEvent(
        overlapInput,
        params.session,
      );

    if (hasOverlap) {
      throw new EventAssignmentOverlapConflictError(
        "Assignment overlap conflict detected with another SCHEDULED or IN_PROGRESS event",
      );
    }
  }

  private async assertNoResourceOverlapConflicts(params: {
    readonly studioResourceIds: readonly string[];
    readonly eventStartAt: number;
    readonly eventEndAt: number;
    readonly excludeEventId?: string;
    readonly session: ClientSession;
  }): Promise<void> {
    const overlapInput:
      EventOverlapResourceCheckInput = {
      studioResourceIds: params.studioResourceIds,
      eventStartAt: params.eventStartAt,
      eventEndAt: params.eventEndAt,
      excludeEventId: params.excludeEventId,
    };

    const hasOverlap =
      await this.repository.hasLiveOverlappingResourceEvent(
        overlapInput,
        params.session,
      );

    if (hasOverlap) {
      throw new EventAssignmentOverlapConflictError(
        "Studio resource overlap conflict detected with another SCHEDULED or IN_PROGRESS event",
      );
    }
  }

  private async assertNoPlatformOverlapConflicts(params: {
    readonly platformAccountIds: readonly string[];
    readonly eventStartAt: number;
    readonly eventEndAt: number;
    readonly excludeEventId?: string;
    readonly session: ClientSession;
  }): Promise<void> {
    const overlapInput:
      EventOverlapPlatformCheckInput = {
      platformAccountIds: params.platformAccountIds,
      eventStartAt: params.eventStartAt,
      eventEndAt: params.eventEndAt,
      excludeEventId: params.excludeEventId,
    };

    const hasOverlap =
      await this.repository.hasLiveOverlappingPlatformEvent(
        overlapInput,
        params.session,
      );

    if (hasOverlap) {
      throw new EventAssignmentOverlapConflictError(
        "Platform account overlap conflict detected with another SCHEDULED or IN_PROGRESS event",
      );
    }
  }

  private async recordAudit(params: {
    readonly actor: Actor;
    readonly permission: PermissionContract;
    readonly eventId: string;
    readonly mutationType: AuthoritativeAdminMutationIdentity;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly session: ClientSession;
  }): Promise<void> {
    await this.audit.record(
      params.actor,
      params.permission,
      params.eventId,
      {
        mutationType: params.mutationType,
        targetId: params.eventId,
        targetType: "event",
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
            classifyEventAssignmentMutationFailure(
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

function normalizeCreateCommand(
  command: CreateEventCommand,
): NormalizedCreateCommand {
  const eventStartAt = normalizeTimestamp(
    command.eventStartAt,
    "eventStartAt",
  );
  const eventEndAt = normalizeTimestamp(
    command.eventEndAt,
    "eventEndAt",
  );

  assertValidEventWindow(eventStartAt, eventEndAt);

  const title = normalizeRequiredText(
    command.title,
    "title",
  );

  return {
    eventCode: normalizeRequiredText(
      command.eventCode,
      "eventCode",
    ),
    title,
    normalizedTitle: canonicalizeTitle(title),
    assignments: normalizeAssignments(
      command.assignments,
      "assignments",
      false,
    ),
    studioResourceIds: normalizeCanonicalIdSet(
      command.studioResourceIds,
      "studioResourceIds",
      true,
    ),
    platformAccountIds: normalizeCanonicalIdSet(
      command.platformAccountIds,
      "platformAccountIds",
      true,
    ),
    eventStartAt,
    eventEndAt,
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

function normalizeUpdateCoreCommand(
  command: UpdateEventCoreCommand,
): NormalizedUpdateCoreCommand {
  const title = normalizeOptionalNonNullableText(
    command.title,
    "title",
  );

  return {
    eventId: normalizeRequiredText(
      command.eventId,
      "eventId",
    ),
    title,
    normalizedTitle:
      title === undefined
        ? undefined
        : canonicalizeTitle(title),
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

function normalizeRescheduleCommand(
  command: RescheduleEventCommand,
): NormalizedRescheduleCommand {
  const newEventStartAt = normalizeTimestamp(
    command.newEventStartAt,
    "newEventStartAt",
  );
  const newEventEndAt = normalizeTimestamp(
    command.newEventEndAt,
    "newEventEndAt",
  );

  assertValidEventWindow(
    newEventStartAt,
    newEventEndAt,
  );

  return {
    eventId: normalizeRequiredText(
      command.eventId,
      "eventId",
    ),
    newEventStartAt,
    newEventEndAt,
  };
}

function normalizeReplaceAssignmentsCommand(
  command: ReplaceEventAssignmentsCommand,
): NormalizedReplaceAssignmentsCommand {
  return {
    eventId: normalizeRequiredText(
      command.eventId,
      "eventId",
    ),
    replacementAssignments:
      normalizeAssignments(
        command.replacementAssignments,
        "replacementAssignments",
        false,
      ),
  };
}

function normalizeUpdateStudioResourcesCommand(
  command: UpdateEventStudioResourcesCommand,
): NormalizedUpdateStudioResourcesCommand {
  return {
    eventId: normalizeRequiredText(
      command.eventId,
      "eventId",
    ),
    newStudioResourceIds:
      normalizeCanonicalIdSet(
        command.newStudioResourceIds,
        "newStudioResourceIds",
        false,
      ),
  };
}

function normalizeUpdatePlatformAccountsCommand(
  command: UpdateEventPlatformAccountsCommand,
): NormalizedUpdatePlatformAccountsCommand {
  return {
    eventId: normalizeRequiredText(
      command.eventId,
      "eventId",
    ),
    newPlatformAccountIds:
      normalizeCanonicalIdSet(
        command.newPlatformAccountIds,
        "newPlatformAccountIds",
        false,
      ),
  };
}

function normalizeLifecycleCommand(
  command:
    | StartEventCommand
    | CompleteEventCommand
    | CancelEventCommand
    | ArchiveEventCommand,
): NormalizedLifecycleCommand {
  return {
    eventId: normalizeRequiredText(
      command.eventId,
      "eventId",
    ),
  };
}

function normalizeAssignments(
  value: unknown,
  field: string,
  allowUndefined: boolean,
): readonly NormalizedAssignmentReference[] {
  if (value === undefined) {
    if (allowUndefined) {
      return [];
    }

    throw new EventAssignmentValidationError(
      `${field} must be an array`,
    );
  }

  if (!Array.isArray(value)) {
    throw new EventAssignmentValidationError(
      `${field} must be an array`,
    );
  }

  const normalized: NormalizedAssignmentReference[] =
    value.map((item, index) =>
      normalizeAssignmentInput(
        item,
        `${field}[${index}]`,
      ),
    );

  const signatures = new Set<string>();

  for (const assignment of normalized) {
    const signature =
      buildAssignmentSignature(assignment);

    if (signatures.has(signature)) {
      throw new EventAssignmentValidationError(
        `${field} must not contain duplicate exact assignment references`,
      );
    }

    signatures.add(signature);
  }

  return [...normalized].sort(
    compareAssignmentReferences,
  );
}

const ASSIGNMENT_INPUT_ALLOWED_FIELDS: readonly string[] =
  Object.freeze([
    "assignmentKind",
    "assignmentEmploymentProfileId",
    "assignmentTalentId",
    "assignmentTalentGroupId",
  ]);

const ASSIGNMENT_INPUT_FORBIDDEN_FIELDS: readonly string[] =
  Object.freeze([
    "id",
    "assignmentStatus",
    "removedAt",
  ]);

function normalizeAssignmentInput(
  value: unknown,
  field: string,
): NormalizedAssignmentReference {
  assertPlainAssignmentInputObject(value, field);
  assertAssignmentInputFieldSet(value, field);

  const assignmentKind = normalizeAssignmentKind(
    value.assignmentKind,
    `${field}.assignmentKind`,
  );
  const assignmentEmploymentProfileId =
    normalizeOptionalNullableId(
      value.assignmentEmploymentProfileId,
      `${field}.assignmentEmploymentProfileId`,
    );
  const assignmentTalentId =
    normalizeOptionalNullableId(
      value.assignmentTalentId,
      `${field}.assignmentTalentId`,
    );
  const assignmentTalentGroupId =
    normalizeOptionalNullableId(
      value.assignmentTalentGroupId,
      `${field}.assignmentTalentGroupId`,
    );

  assertAssignmentReferenceShape(
    {
      assignmentKind,
      assignmentEmploymentProfileId,
      assignmentTalentId,
      assignmentTalentGroupId,
    },
    field,
  );

  return {
    assignmentKind,
    assignmentEmploymentProfileId,
    assignmentTalentId,
    assignmentTalentGroupId,
  };
}

function assertPlainAssignmentInputObject(
  value: unknown,
  field: string,
): asserts value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new EventAssignmentValidationError(
      `${field} must be an object`,
    );
  }

  const prototype = Object.getPrototypeOf(value);

  if (
    prototype === Object.prototype ||
    prototype === null
  ) {
    return;
  }

  throw new EventAssignmentValidationError(
    `${field} must be an object`,
  );
}

function assertAssignmentInputFieldSet(
  value: Readonly<Record<string, unknown>>,
  field: string,
): void {
  const fieldNames = Object.keys(value);
  const forbiddenFields = fieldNames.filter(
    (name) =>
      ASSIGNMENT_INPUT_FORBIDDEN_FIELDS.includes(
        name,
      ),
  );

  if (forbiddenFields.length > 0) {
    throw new EventAssignmentValidationError(
      `${field} contains forbidden field(s): ${forbiddenFields.join(", ")}`,
    );
  }

  const unexpectedFields = fieldNames.filter(
    (name) =>
      !ASSIGNMENT_INPUT_ALLOWED_FIELDS.includes(name),
  );

  if (unexpectedFields.length === 0) {
    return;
  }

  throw new EventAssignmentValidationError(
    `${field} contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}

function normalizeAssignmentKind(
  value: unknown,
  field: string,
): EventAssignmentKind {
  if (typeof value !== "string") {
    throw new EventAssignmentValidationError(
      `${field} must be one of ${EVENT_ASSIGNMENT_KINDS.join(", ")}`,
    );
  }

  const normalized = value
    .trim()
    .toUpperCase();

  if (
    EVENT_ASSIGNMENT_KINDS.includes(
      normalized as EventAssignmentKind,
    )
  ) {
    return normalized as EventAssignmentKind;
  }

  throw new EventAssignmentValidationError(
    `${field} must be one of ${EVENT_ASSIGNMENT_KINDS.join(", ")}`,
  );
}

function assertAssignmentReferenceShape(
  assignment: NormalizedAssignmentReference,
  field: string,
): void {
  switch (assignment.assignmentKind) {
    case "EMPLOYMENT_PROFILE":
      if (
        assignment.assignmentEmploymentProfileId &&
        assignment.assignmentTalentId === null &&
        assignment.assignmentTalentGroupId === null
      ) {
        return;
      }

      throw new EventAssignmentValidationError(
        `${field} requires assignmentEmploymentProfileId and forbids assignmentTalentId/assignmentTalentGroupId for assignmentKind EMPLOYMENT_PROFILE`,
      );

    case "TALENT":
      if (
        assignment.assignmentTalentId &&
        assignment.assignmentEmploymentProfileId === null &&
        assignment.assignmentTalentGroupId === null
      ) {
        return;
      }

      throw new EventAssignmentValidationError(
        `${field} requires assignmentTalentId and forbids assignmentEmploymentProfileId/assignmentTalentGroupId for assignmentKind TALENT`,
      );

    case "TALENT_GROUP":
      if (
        assignment.assignmentTalentGroupId &&
        assignment.assignmentEmploymentProfileId === null &&
        assignment.assignmentTalentId === null
      ) {
        return;
      }

      throw new EventAssignmentValidationError(
        `${field} requires assignmentTalentGroupId and forbids assignmentEmploymentProfileId/assignmentTalentId for assignmentKind TALENT_GROUP`,
      );
  }
}

function normalizeRequiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new EventAssignmentValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new EventAssignmentValidationError(
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
    throw new EventAssignmentValidationError(
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
    throw new EventAssignmentValidationError(
      `${field} must be an integer UTC timestamp`,
    );
  }

  return value;
}

function normalizeCanonicalIdSet(
  value: unknown,
  field: string,
  allowUndefined: boolean,
): readonly string[] {
  if (value === undefined) {
    if (allowUndefined) {
      return [];
    }

    throw new EventAssignmentValidationError(
      `${field} must be an array`,
    );
  }

  if (!Array.isArray(value)) {
    throw new EventAssignmentValidationError(
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
    throw new EventAssignmentValidationError(
      `${field} must not contain duplicate values`,
    );
  }

  return [...distinct].sort();
}

function resolveRequiredGlobalScope(
  actor: Actor,
): "global" {
  if (
    PermissionGuard.hasEventAssignmentScopeGrant(
      actor,
      "global",
    )
  ) {
    return "global";
  }

  throw new EventAssignmentPermissionScopeError(
    "Event assignment mutations require global scope",
  );
}

function assertValidEventWindow(
  eventStartAt: number,
  eventEndAt: number,
): void {
  if (eventEndAt <= eventStartAt) {
    throw new EventAssignmentValidationError(
      "eventEndAt must be strictly greater than eventStartAt",
    );
  }
}

function assertHasActiveAssignments(
  assignments: readonly NormalizedAssignmentReference[],
  field: string,
): void {
  if (assignments.length > 0) {
    return;
  }

  throw new EventAssignmentValidationError(
    `${field} must contain at least one ACTIVE assignment reference`,
  );
}

function buildUpdateEventCoreInput(params: {
  readonly current: EventRecord;
  readonly command: NormalizedUpdateCoreCommand;
}): {
  readonly update: UpdateEventCoreInput;
  readonly changedFields: readonly string[];
} {
  type MutableUpdateEventCoreInput = {
    -readonly [K in keyof UpdateEventCoreInput]:
      UpdateEventCoreInput[K];
  };
  const changedFields: string[] = [];
  const update: MutableUpdateEventCoreInput = {
    eventId: params.current.id,
    updatedAt: Date.now(),
  };

  if (
    params.command.title !== undefined &&
    params.command.title !== params.current.title
  ) {
    update.title = params.command.title;
    update.normalizedTitle =
      params.command.normalizedTitle;
    changedFields.push("title");
  }

  if (
    params.command.description !== undefined &&
    params.command.description !==
      params.current.description
  ) {
    update.description =
      params.command.description;
    changedFields.push("description");
  }

  if (
    params.command.externalRef !== undefined &&
    params.command.externalRef !==
      params.current.externalRef
  ) {
    update.externalRef =
      params.command.externalRef;
    changedFields.push("externalRef");
  }

  return {
    update,
    changedFields,
  };
}

function assertScheduledForStructuralMutation(
  current: EventRecord,
  operation: string,
): void {
  if (current.status === "SCHEDULED") {
    return;
  }

  throw new EventAssignmentStateError(
    `${operation} requires status SCHEDULED, received ${current.status}`,
  );
}

function toAssignmentOverlapReferenceBuckets(
  assignments:
    | readonly NormalizedAssignmentReference[]
    | readonly EventAssignmentRecord[],
): {
  readonly assignmentEmploymentProfileIds: readonly string[];
  readonly assignmentTalentIds: readonly string[];
  readonly assignmentTalentGroupIds: readonly string[];
} {
  const employmentProfileIds = new Set<string>();
  const talentIds = new Set<string>();
  const talentGroupIds = new Set<string>();

  for (const assignment of assignments) {
    switch (assignment.assignmentKind) {
      case "EMPLOYMENT_PROFILE": {
        const id =
          assignment.assignmentEmploymentProfileId;

        if (id) {
          employmentProfileIds.add(id);
        }

        break;
      }

      case "TALENT": {
        const id = assignment.assignmentTalentId;

        if (id) {
          talentIds.add(id);
        }

        break;
      }

      case "TALENT_GROUP": {
        const id =
          assignment.assignmentTalentGroupId;

        if (id) {
          talentGroupIds.add(id);
        }

        break;
      }
    }
  }

  return {
    assignmentEmploymentProfileIds: [
      ...employmentProfileIds,
    ].sort(),
    assignmentTalentIds: [...talentIds].sort(),
    assignmentTalentGroupIds: [
      ...talentGroupIds,
    ].sort(),
  };
}

function compareAssignmentReferences(
  left: NormalizedAssignmentReference,
  right: NormalizedAssignmentReference,
): number {
  if (left.assignmentKind < right.assignmentKind) {
    return -1;
  }

  if (left.assignmentKind > right.assignmentKind) {
    return 1;
  }

  const leftReference = readAssignmentReferenceId(
    left,
  );
  const rightReference = readAssignmentReferenceId(
    right,
  );

  if (leftReference < rightReference) {
    return -1;
  }

  if (leftReference > rightReference) {
    return 1;
  }

  return 0;
}

function areCanonicalAssignmentSetsEqual(
  currentActiveAssignments: readonly EventAssignmentRecord[],
  replacementAssignments: readonly NormalizedAssignmentReference[],
): boolean {
  if (
    currentActiveAssignments.length !==
    replacementAssignments.length
  ) {
    return false;
  }

  const currentSignatures =
    currentActiveAssignments
      .map(buildAssignmentSignature)
      .sort();
  const replacementSignatures =
    replacementAssignments
      .map(buildAssignmentSignature)
      .sort();

  for (
    let index = 0;
    index < currentSignatures.length;
    index += 1
  ) {
    if (
      currentSignatures[index] !==
      replacementSignatures[index]
    ) {
      return false;
    }
  }

  return true;
}

function buildAssignmentSignature(
  assignment:
    | NormalizedAssignmentReference
    | EventAssignmentRecord,
): string {
  return `${assignment.assignmentKind}:${readAssignmentReferenceId(
    assignment,
  )}`;
}

function readAssignmentReferenceId(
  assignment:
    | NormalizedAssignmentReference
    | EventAssignmentRecord,
): string {
  switch (assignment.assignmentKind) {
    case "EMPLOYMENT_PROFILE":
      return (
        assignment.assignmentEmploymentProfileId ??
        ""
      );

    case "TALENT":
      return assignment.assignmentTalentId ?? "";

    case "TALENT_GROUP":
      return (
        assignment.assignmentTalentGroupId ?? ""
      );
  }
}

function summarizeAssignmentReferences(
  assignments:
    | readonly NormalizedAssignmentReference[]
    | readonly EventAssignmentRecord[],
): readonly string[] {
  return assignments
    .map(buildAssignmentSignature)
    .sort();
}

function areCanonicalIdSetsEqual(
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

function canonicalizeTitle(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function assertAdminActorType(
  actor: Actor,
): void {
  if (actor.type === "admin") {
    return;
  }

  throw new SystemInvariantError(
    "PERMISSION_DENIED",
    `Event assignment access requires actor.type admin, received ${actor.type}`,
  );
}

function toEventMutationView(
  record: EventRecord,
): EventMutationView {
  return {
    id: record.id,
    eventCode: record.eventCode,
    title: record.title,
    studioResourceIds: [
      ...record.studioResourceIds,
    ],
    platformAccountIds: [
      ...record.platformAccountIds,
    ],
    status: record.status,
    eventStartAt: record.eventStartAt,
    eventEndAt: record.eventEndAt,
    description: record.description,
    externalRef: record.externalRef,
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

function classifyEventAssignmentMutationFailure(
  error: unknown,
): EventAssignmentMutationFailureClassification {
  if (
    error instanceof EventAssignmentValidationError
  ) {
    return "validation";
  }

  if (
    error instanceof EventAssignmentConflictError
  ) {
    return "conflict";
  }

  if (
    error instanceof EventAssignmentNotFoundError
  ) {
    return "not_found";
  }

  if (error instanceof EventAssignmentStateError) {
    return "state_error";
  }

  if (
    error instanceof
    EventAssignmentInvalidAssignmentReferenceError
  ) {
    return "invalid_assignment_reference";
  }

  if (
    error instanceof
    EventAssignmentInvalidResourceReferenceError
  ) {
    return "invalid_resource_reference";
  }

  if (
    error instanceof
    EventAssignmentInvalidPlatformReferenceError
  ) {
    return "invalid_platform_reference";
  }

  if (
    error instanceof
    EventAssignmentOverlapConflictError
  ) {
    return "overlap_conflict";
  }

  if (
    error instanceof
    EventAssignmentPermissionScopeError
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
