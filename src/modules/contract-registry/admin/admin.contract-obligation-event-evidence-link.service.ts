import crypto from "crypto";
import {
  ClientSession,
  MongoServerError,
} from "mongodb";
import { Actor } from "@core/actor/actor";
import { AuthoritativeAdminMutationBridge } from "@core/application/authoritative-admin-mutation.bridge";
import { AuthoritativeAdminMutationIdentity } from "@core/application/authoritative-admin-mutation.permission-map";
import { AuditGuard } from "@core/audit/audit.guard";
import { SystemInvariantError } from "@core/error/system-error";
import { PermissionContract } from "@core/permission/permission.contract";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import { EventAssignmentRepository } from "@modules/event-assignment/domain/event-assignment.repository";
import { EventRecord } from "@modules/event-assignment/domain/event-assignment.types";
import { ContractObligationEventEvidenceLinkRepository } from "../domain/contract-obligation-event-evidence-link.repository";
import {
  ContractObligationEventEvidenceLink,
  toContractObligationEventEvidenceLinkView,
} from "../domain/contract-obligation-event-evidence-link.types";
import { ContractObligationRepository } from "../domain/contract-obligation.repository";
import {
  ContractObligationEligibilityError,
  ContractObligationNotFoundError,
  ContractObligationStateError,
  ContractObligationValidationError,
  ContractRegistryPermissionScopeError,
} from "../domain/contract-registry.errors";
import { ContractRegistryRepository } from "../domain/contract-registry.repository";
import { isCommercialLegalContractKind } from "../domain/contract-registry.types";
import {
  CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_REASON_MAX_LENGTH,
  ContractObligationEventEvidenceLinkMutationResult,
  LinkContractObligationEventEvidenceCommand,
  RemoveContractObligationEventEvidenceCommand,
} from "../shared/contract-obligation-event-evidence-link.contracts";

export class ContractObligationEventEvidenceLinkAdminService {
  constructor(
    private readonly linkRepository: ContractObligationEventEvidenceLinkRepository,
    private readonly obligationRepository: ContractObligationRepository,
    private readonly contractRepository: ContractRegistryRepository,
    private readonly eventRepository: EventAssignmentRepository,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
  ) {}

  async link(
    actor: Actor,
    command: LinkContractObligationEventEvidenceCommand,
  ): Promise<ContractObligationEventEvidenceLinkMutationResult> {
    const operation = "contract-obligation.event-evidence-link.create";
    const permission = this.assertPermission(
      actor,
      Permission.CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK,
    );
    const input = {
      contractObligationId: normalizeRequiredText(
        command.contractObligationId,
        "contractObligationId",
      ),
      eventId: normalizeRequiredText(command.eventId, "eventId"),
      linkReason: normalizeRequiredText(
        command.linkReason,
        "linkReason",
        CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_REASON_MAX_LENGTH,
      ),
    };

    return this.executeMutation(
      actor,
      permission,
      operation,
      input.contractObligationId,
      async (session) => {
        const obligation =
          await this.obligationRepository.findById(
            input.contractObligationId,
            session,
          );
        if (!obligation) {
          throw new ContractObligationNotFoundError(
            input.contractObligationId,
          );
        }
        if (obligation.status !== "OPEN") {
          throw new ContractObligationStateError(
            "Event evidence links can only be created while the obligation is OPEN",
          );
        }
        await this.requireEligibleContract(
          obligation.contractRecordId,
          session,
        );

        const event = await this.eventRepository.findEventById(
          input.eventId,
          session,
        );
        if (!event) {
          throw new ContractObligationValidationError(
            `Event not found: ${input.eventId}`,
          );
        }
        assertEventCanBeLinked(event);

        const duplicate =
          await this.linkRepository.findActiveByObligationAndEvent(
            obligation.id,
            event.id,
            session,
          );
        if (duplicate) {
          throw new ContractObligationStateError(
            "An ACTIVE event evidence link already exists for this obligation and Event",
          );
        }

        const now = Date.now();
        const link: ContractObligationEventEvidenceLink = {
          id: crypto.randomUUID(),
          contractObligationId: obligation.id,
          contractRecordId: obligation.contractRecordId,
          eventId: event.id,
          status: "ACTIVE",
          linkedByActorId: actor.id,
          linkedAt: now,
          linkReason: input.linkReason,
          removedByActorId: null,
          removedAt: null,
          removeReason: null,
          snapshot: {
            eventId: event.id,
            eventCode: event.eventCode,
            eventTitle: event.title,
            eventStatus: event.status,
            eventUpdatedAt: event.updatedAt,
            eventCompletedAt: event.completedAt,
            eventCompletedByActorId: event.completedByActorId,
            completionEvidenceNote:
              event.completionEvidenceNote,
            completionEvidenceRefs: [
              ...event.completionEvidenceRefs,
            ],
          },
          actionHistory: [
            {
              action: "LINKED",
              actorId: actor.id,
              occurredAt: now,
              reason: input.linkReason,
            },
          ],
          createdByActorId: actor.id,
          createdAt: now,
          updatedByActorId: actor.id,
          updatedAt: now,
        };

        try {
          const created = await this.linkRepository.insert(
            link,
            session,
          );
          await this.recordAudit(
            actor,
            permission,
            operation,
            created,
            {
              contractObligationId: created.contractObligationId,
              contractRecordId: created.contractRecordId,
              eventId: created.eventId,
              nextStatus: created.status,
              evidenceRefCount:
                created.snapshot.completionEvidenceRefs.length,
            },
            session,
          );
          return toContractObligationEventEvidenceLinkView(
            created,
          );
        } catch (error) {
          if (
            error instanceof MongoServerError &&
            error.code === 11000
          ) {
            throw new ContractObligationStateError(
              "An ACTIVE event evidence link already exists for this obligation and Event",
            );
          }
          throw error;
        }
      },
    );
  }

  async remove(
    actor: Actor,
    command: RemoveContractObligationEventEvidenceCommand,
  ): Promise<ContractObligationEventEvidenceLinkMutationResult> {
    const operation = "contract-obligation.event-evidence-link.remove";
    const permission = this.assertPermission(
      actor,
      Permission.CONTRACT_OBLIGATION_EVENT_EVIDENCE_REMOVE,
    );
    const input = {
      linkId: normalizeRequiredText(command.linkId, "linkId"),
      removeReason: normalizeRequiredText(
        command.removeReason,
        "removeReason",
        CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_REASON_MAX_LENGTH,
      ),
    };

    return this.executeMutation(
      actor,
      permission,
      operation,
      input.linkId,
      async (session) => {
        const current = await this.linkRepository.findById(
          input.linkId,
          session,
        );
        if (!current) {
          throw new ContractObligationValidationError(
            `Contract obligation event evidence link not found: ${input.linkId}`,
          );
        }
        if (current.status !== "ACTIVE") {
          throw new ContractObligationStateError(
            "Only ACTIVE event evidence links can be removed",
          );
        }

        const obligation =
          await this.obligationRepository.findById(
            current.contractObligationId,
            session,
          );
        if (!obligation) {
          throw new ContractObligationNotFoundError(
            current.contractObligationId,
          );
        }
        if (obligation.status !== "OPEN") {
          throw new ContractObligationStateError(
            "Event evidence links can only be removed while the obligation is OPEN",
          );
        }
        await this.requireEligibleContract(
          obligation.contractRecordId,
          session,
        );

        const now = Date.now();
        const removed = await this.linkRepository.softRemove(
          {
            linkId: current.id,
            action: {
              action: "REMOVED",
              actorId: actor.id,
              occurredAt: now,
              reason: input.removeReason,
            },
            removedByActorId: actor.id,
            removedAt: now,
            removeReason: input.removeReason,
            updatedByActorId: actor.id,
            updatedAt: now,
          },
          session,
        );
        if (!removed) {
          throw new ContractObligationStateError(
            "Only ACTIVE event evidence links can be removed",
          );
        }
        await this.recordAudit(
          actor,
          permission,
          operation,
          removed,
          {
            contractObligationId: removed.contractObligationId,
            contractRecordId: removed.contractRecordId,
            eventId: removed.eventId,
            previousStatus: current.status,
            nextStatus: removed.status,
          },
          session,
        );
        return toContractObligationEventEvidenceLinkView(removed);
      },
    );
  }

  private async requireEligibleContract(
    contractRecordId: string,
    session: ClientSession,
  ): Promise<void> {
    const contract = await this.contractRepository.findById(
      contractRecordId,
      session,
    );
    if (!contract) {
      throw new ContractObligationEligibilityError(
        `Contract record does not exist: ${contractRecordId}`,
      );
    }
    if (
      contract.status !== "ACTIVE" ||
      !isCommercialLegalContractKind(contract.contractKind)
    ) {
      throw new ContractObligationEligibilityError(
        "Only ACTIVE TALENT_SERVICE or TALENT_MANAGEMENT contract records can receive or process obligations",
      );
    }
  }

  private assertPermission(
    actor: Actor,
    permissionCode: Permission,
  ): PermissionContract {
    assertAdminActorType(actor);
    resolveRequiredGlobalScope(actor);
    const permission =
      PermissionResolver.resolve(permissionCode);
    PermissionGuard.assert(actor, permission);
    return permission;
  }

  private async recordAudit(
    actor: Actor,
    permission: PermissionContract,
    operation: AuthoritativeAdminMutationIdentity,
    link: ContractObligationEventEvidenceLink,
    metadata: Readonly<Record<string, unknown>>,
    session: ClientSession,
  ): Promise<void> {
    await this.audit.record(
      actor,
      permission,
      link.id,
      {
        mutationType: operation,
        targetId: link.id,
        targetType: "contract-obligation-event-evidence-link",
        actorId: actor.id,
        ...metadata,
      },
      session,
    );
  }

  private async executeMutation<T>(
    actor: Actor,
    permission: PermissionContract,
    operation: AuthoritativeAdminMutationIdentity,
    targetId: string,
    fn: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    return this.mutationBridge.execute(
      {
        actor,
        traceId: getTraceIdOrThrow(),
        requiredPermission: permission,
        mutationIdentity: operation,
        mutationTargetDescriptor: targetId,
      },
      async (session) => fn(session),
    );
  }
}

type LinkableCompletedEvent = EventRecord & {
  readonly status: "COMPLETED";
  readonly completedAt: number;
  readonly completedByActorId: string;
  readonly completionEvidenceNote: string;
};

function assertEventCanBeLinked(
  event: EventRecord,
): asserts event is LinkableCompletedEvent {
  if (event.status !== "COMPLETED") {
    throw new ContractObligationStateError(
      "Only COMPLETED Events can be linked as obligation evidence",
    );
  }
  if (
    event.completedAt === null ||
    event.completedByActorId === null ||
    event.completionEvidenceNote === null ||
    !event.completionEvidenceNote.trim()
  ) {
    throw new ContractObligationStateError(
      "Only completed Events with persisted completion evidence can be linked",
    );
  }
}

function normalizeRequiredText(
  value: unknown,
  field: string,
  maxLength?: number,
): string {
  if (typeof value !== "string") {
    throw new ContractObligationValidationError(
      `${field} must be a string`,
    );
  }
  const normalized = value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");
  if (!normalized) {
    throw new ContractObligationValidationError(
      `${field} is required`,
    );
  }
  if (maxLength && normalized.length > maxLength) {
    throw new ContractObligationValidationError(
      `${field} must be at most ${maxLength} characters`,
    );
  }
  return normalized;
}

function resolveRequiredGlobalScope(actor: Actor): void {
  if (
    PermissionGuard.hasContractRegistryScopeGrant(
      actor,
      "global",
    )
  ) {
    return;
  }
  throw new ContractRegistryPermissionScopeError(
    "Contract obligation event evidence links require global Contract Registry scope",
  );
}

function assertAdminActorType(actor: Actor): void {
  if (actor.type === "admin") {
    return;
  }
  throw new SystemInvariantError(
    "PERMISSION_DENIED",
    `Contract obligation event evidence link access requires actor.type admin, received ${actor.type}`,
  );
}
