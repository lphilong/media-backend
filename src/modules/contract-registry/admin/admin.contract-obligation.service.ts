import crypto from "crypto";
import {
  ClientSession,
  MongoServerError,
} from "mongodb";
import { Actor } from "@core/actor/actor";
import {
  AuthoritativeAdminMutationBridge,
} from "@core/application/authoritative-admin-mutation.bridge";
import { AuthoritativeAdminMutationIdentity } from "@core/application/authoritative-admin-mutation.permission-map";
import { AuditGuard } from "@core/audit/audit.guard";
import { utcYearBucketFromTimestamp } from "@core/business-code/business-code-bucket";
import {
  BusinessCodeSequenceRepository,
  formatBusinessCode,
} from "@core/business-code/business-code-sequence.repository";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { PermissionContract } from "@core/permission/permission.contract";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import { ContractRegistryEmploymentProfileReadonlyAccess } from "../domain/contract-registry-employment-profile-readonly-access";
import { buildContractObligationCodePolicy } from "../domain/contract-obligation-code-policy";
import { ContractObligationEventEvidenceLinkRepository } from "../domain/contract-obligation-event-evidence-link.repository";
import { ContractObligationRepository } from "../domain/contract-obligation.repository";
import {
  CONTRACT_OBLIGATION_EVIDENCE_POLICIES,
  CONTRACT_OBLIGATION_EVIDENCE_REF_TYPES,
  CONTRACT_OBLIGATION_TYPES,
  ContractObligation,
  ContractObligationEvidencePolicy,
  ContractObligationEvidenceRef,
  ContractObligationStatus,
  ContractObligationType,
  toContractObligationView,
} from "../domain/contract-obligation.types";
import {
  ContractObligationEligibilityError,
  ContractObligationNotFoundError,
  ContractObligationSelfAcceptanceError,
  ContractObligationStateError,
  ContractObligationValidationError,
  ContractRegistryInvalidOwnerReferenceError,
  ContractRegistryPermissionScopeError,
} from "../domain/contract-registry.errors";
import { ContractRegistryRepository } from "../domain/contract-registry.repository";
import {
  isCommercialLegalContractKind,
} from "../domain/contract-registry.types";
import {
  AcceptContractObligationCommand,
  ArchiveContractObligationCommand,
  CancelContractObligationCommand,
  CONTRACT_OBLIGATION_DELIVERY_NOTE_MAX_LENGTH,
  CONTRACT_OBLIGATION_DESCRIPTION_MAX_LENGTH,
  CONTRACT_OBLIGATION_EVIDENCE_REF_LABEL_MAX_LENGTH,
  CONTRACT_OBLIGATION_EVIDENCE_REF_MAX_COUNT,
  CONTRACT_OBLIGATION_EVIDENCE_REF_REFERENCE_ID_MAX_LENGTH,
  CONTRACT_OBLIGATION_EVIDENCE_REF_URL_MAX_LENGTH,
  CONTRACT_OBLIGATION_REASON_MAX_LENGTH,
  CONTRACT_OBLIGATION_TITLE_MAX_LENGTH,
  ContractObligationLifecycleCommand,
  ContractObligationMutationResult,
  CreateContractObligationCommand,
  DeliverContractObligationCommand,
  RejectContractObligationCommand,
  ReopenContractObligationCommand,
  UpdateContractObligationCommand,
} from "../shared/contract-obligation.contracts";

export class ContractObligationAdminService {
  constructor(
    private readonly obligationRepository: ContractObligationRepository,
    private readonly eventEvidenceLinkRepository: ContractObligationEventEvidenceLinkRepository,
    private readonly contractRepository: ContractRegistryRepository,
    private readonly codeSequenceRepository: BusinessCodeSequenceRepository,
    private readonly employmentProfileReadonlyAccess: ContractRegistryEmploymentProfileReadonlyAccess,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
  ) {}

  async create(
    actor: Actor,
    command: CreateContractObligationCommand,
  ): Promise<ContractObligationMutationResult> {
    const operation = "contract-obligation.create";
    const permission = this.assertPermission(
      actor,
      Permission.CONTRACT_OBLIGATION_MANAGE_DRAFT,
    );
    const input = normalizeCreateCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      input.contractRecordId,
      async (session) => {
        await this.requireEligibleContract(
          input.contractRecordId,
          session,
        );
        await this.requireResponsibleOwner(
          input.responsibleOwnerEmploymentProfileId,
          session,
        );
        const now = Date.now();
        const code = await this.allocateCode(now, session);
        const obligation: ContractObligation = {
          id: crypto.randomUUID(),
          code,
          contractRecordId: input.contractRecordId,
          obligationType: input.obligationType,
          title: input.title,
          description: input.description,
          dueDate: input.dueDate,
          responsibleOwnerEmploymentProfileId:
            input.responsibleOwnerEmploymentProfileId,
          evidencePolicy: input.evidencePolicy,
          status: "DRAFT",
          latestDeliveryNote: null,
          latestEvidenceRefs: [],
          latestEventEvidenceLinkIds: [],
          latestDeliveredByActorId: null,
          latestDeliveredAt: null,
          latestReviewedByActorId: null,
          latestReviewedAt: null,
          acceptedByActorId: null,
          acceptedAt: null,
          rejectedByActorId: null,
          rejectedAt: null,
          rejectionReason: null,
          statusHistory: [
            {
              fromStatus: null,
              toStatus: "DRAFT",
              actorId: actor.id,
              occurredAt: now,
              reason: null,
            },
          ],
          createdByActorId: actor.id,
          createdAt: now,
          updatedByActorId: actor.id,
          updatedAt: now,
        };

        try {
          const created =
            await this.obligationRepository.insert(
              obligation,
              session,
            );
          await this.recordAudit(
            actor,
            permission,
            operation,
            created,
            { nextStatus: created.status },
            session,
          );
          return toContractObligationView(created);
        } catch (error) {
          if (
            error instanceof MongoServerError &&
            error.code === 11000
          ) {
            throw new ContractObligationStateError(
              "Contract obligation code already exists",
            );
          }
          throw error;
        }
      },
    );
  }

  async update(
    actor: Actor,
    command: UpdateContractObligationCommand,
  ): Promise<ContractObligationMutationResult> {
    const operation = "contract-obligation.update";
    const permission = this.assertPermission(
      actor,
      Permission.CONTRACT_OBLIGATION_MANAGE_DRAFT,
    );
    const input = normalizeUpdateCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      input.obligationId,
      async (session) => {
        const current = await this.requireObligation(
          input.obligationId,
          session,
        );
        await this.requireEligibleContract(
          current.contractRecordId,
          session,
        );
        if (input.responsibleOwnerEmploymentProfileId) {
          await this.requireResponsibleOwner(
            input.responsibleOwnerEmploymentProfileId,
            session,
          );
        }
        const now = Date.now();
        const updated =
          await this.obligationRepository.updateMetadata(
            {
              ...input,
              fromStatuses: ["DRAFT", "OPEN"],
              updatedByActorId: actor.id,
              updatedAt: now,
            },
            session,
          );
        if (!updated) {
          throw new ContractObligationStateError(
            "Only DRAFT or OPEN obligations can be updated",
          );
        }
        await this.recordAudit(
          actor,
          permission,
          operation,
          updated,
          { status: updated.status },
          session,
        );
        return toContractObligationView(updated);
      },
    );
  }

  async open(
    actor: Actor,
    command: ContractObligationLifecycleCommand,
  ): Promise<ContractObligationMutationResult> {
    return this.transition(
      actor,
      command.obligationId,
      "contract-obligation.open",
      Permission.CONTRACT_OBLIGATION_MANAGE_LIFECYCLE,
      ["DRAFT"],
      "OPEN",
      null,
    );
  }

  async deliver(
    actor: Actor,
    command: DeliverContractObligationCommand,
  ): Promise<ContractObligationMutationResult> {
    const operation = "contract-obligation.deliver";
    const permission = this.assertPermission(
      actor,
      Permission.CONTRACT_OBLIGATION_DELIVER,
    );
    const obligationId = normalizeRequiredText(
      command.obligationId,
      "obligationId",
    );
    const deliveryNote = normalizeOptionalText(
      command.deliveryNote,
      "deliveryNote",
      CONTRACT_OBLIGATION_DELIVERY_NOTE_MAX_LENGTH,
    );
    const evidenceRefs = normalizeEvidenceRefs(
      command.evidenceRefs,
    );
    const eventEvidenceLinkIds = normalizeEventEvidenceLinkIds(
      command.eventEvidenceLinkIds,
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      obligationId,
      async (session) => {
        const current = await this.requireObligation(
          obligationId,
          session,
        );
        await this.requireEligibleContract(
          current.contractRecordId,
          session,
        );
        const activeEventEvidenceLinks =
          await this.eventEvidenceLinkRepository.listActiveByIdsForObligation(
            current.id,
            eventEvidenceLinkIds,
            session,
          );
        if (
          activeEventEvidenceLinks.length !==
          eventEvidenceLinkIds.length
        ) {
          throw new ContractObligationValidationError(
            "Selected eventEvidenceLinkIds must be ACTIVE and belong to the same obligation",
          );
        }
        if (
          current.evidencePolicy === "REQUIRED" &&
          evidenceRefs.length === 0 &&
          eventEvidenceLinkIds.length === 0
        ) {
          throw new ContractObligationValidationError(
            "At least one direct structured evidence reference or active Event evidence link is required",
          );
        }
        const now = Date.now();
        const updated =
          await this.obligationRepository.transitionStatus(
            {
              obligationId,
              fromStatuses: ["OPEN"],
              toStatus: "DELIVERED",
              transition: transition(
                current.status,
                "DELIVERED",
                actor.id,
                now,
                deliveryNote,
              ),
              latestDeliveryNote: deliveryNote,
              latestEvidenceRefs: evidenceRefs,
              latestEventEvidenceLinkIds: eventEvidenceLinkIds,
              latestDeliveredByActorId: actor.id,
              latestDeliveredAt: now,
              latestReviewedByActorId: null,
              latestReviewedAt: null,
              acceptedByActorId: null,
              acceptedAt: null,
              rejectedByActorId: null,
              rejectedAt: null,
              rejectionReason: null,
              updatedByActorId: actor.id,
              updatedAt: now,
            },
            session,
          );
        return this.finishTransition(
          actor,
          permission,
          operation,
          current,
          updated,
          session,
        );
      },
    );
  }

  async reject(
    actor: Actor,
    command: RejectContractObligationCommand,
  ): Promise<ContractObligationMutationResult> {
    const reason = normalizeReason(command.reason);
    return this.reviewTransition(
      actor,
      command.obligationId,
      "contract-obligation.reject",
      "REJECTED",
      reason,
    );
  }

  async reopen(
    actor: Actor,
    command: ReopenContractObligationCommand,
  ): Promise<ContractObligationMutationResult> {
    return this.transition(
      actor,
      command.obligationId,
      "contract-obligation.reopen",
      Permission.CONTRACT_OBLIGATION_MANAGE_LIFECYCLE,
      ["REJECTED"],
      "OPEN",
      normalizeReason(command.reason),
    );
  }

  async accept(
    actor: Actor,
    command: AcceptContractObligationCommand,
  ): Promise<ContractObligationMutationResult> {
    const reviewNote = normalizeOptionalText(
      command.reviewNote,
      "reviewNote",
      CONTRACT_OBLIGATION_REASON_MAX_LENGTH,
    );
    return this.reviewTransition(
      actor,
      command.obligationId,
      "contract-obligation.accept",
      "ACCEPTED",
      reviewNote,
      true,
    );
  }

  async cancel(
    actor: Actor,
    command: CancelContractObligationCommand,
  ): Promise<ContractObligationMutationResult> {
    return this.transition(
      actor,
      command.obligationId,
      "contract-obligation.cancel",
      Permission.CONTRACT_OBLIGATION_MANAGE_LIFECYCLE,
      ["DRAFT", "OPEN"],
      "CANCELLED",
      normalizeReason(command.reason),
    );
  }

  async archive(
    actor: Actor,
    command: ArchiveContractObligationCommand,
  ): Promise<ContractObligationMutationResult> {
    return this.transition(
      actor,
      command.obligationId,
      "contract-obligation.archive",
      Permission.CONTRACT_OBLIGATION_MANAGE_LIFECYCLE,
      ["ACCEPTED", "CANCELLED"],
      "ARCHIVED",
      normalizeOptionalText(
        command.reason,
        "reason",
        CONTRACT_OBLIGATION_REASON_MAX_LENGTH,
      ),
    );
  }

  private async reviewTransition(
    actor: Actor,
    rawObligationId: string,
    operation:
      | "contract-obligation.accept"
      | "contract-obligation.reject",
    toStatus: "ACCEPTED" | "REJECTED",
    reason: string | null,
    blockSelfAcceptance = false,
  ): Promise<ContractObligationMutationResult> {
    const permission = this.assertPermission(
      actor,
      Permission.CONTRACT_OBLIGATION_REVIEW,
    );
    const obligationId = normalizeRequiredText(
      rawObligationId,
      "obligationId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      obligationId,
      async (session) => {
        const current = await this.requireObligation(
          obligationId,
          session,
        );
        await this.requireEligibleContract(
          current.contractRecordId,
          session,
        );
        if (
          blockSelfAcceptance &&
          current.latestDeliveredByActorId === actor.id
        ) {
          throw new ContractObligationSelfAcceptanceError();
        }
        const now = Date.now();
        const updated =
          await this.obligationRepository.transitionStatus(
            {
              obligationId,
              fromStatuses: ["DELIVERED"],
              toStatus,
              transition: transition(
                current.status,
                toStatus,
                actor.id,
                now,
                reason,
              ),
              latestReviewedByActorId: actor.id,
              latestReviewedAt: now,
              acceptedByActorId:
                toStatus === "ACCEPTED" ? actor.id : null,
              acceptedAt:
                toStatus === "ACCEPTED" ? now : null,
              rejectedByActorId:
                toStatus === "REJECTED" ? actor.id : null,
              rejectedAt:
                toStatus === "REJECTED" ? now : null,
              rejectionReason:
                toStatus === "REJECTED" ? reason : null,
              updatedByActorId: actor.id,
              updatedAt: now,
            },
            session,
          );
        return this.finishTransition(
          actor,
          permission,
          operation,
          current,
          updated,
          session,
        );
      },
    );
  }

  private async transition(
    actor: Actor,
    rawObligationId: string,
    operation: AuthoritativeAdminMutationIdentity,
    permissionCode: Permission,
    fromStatuses: readonly ContractObligationStatus[],
    toStatus: ContractObligationStatus,
    reason: string | null,
  ): Promise<ContractObligationMutationResult> {
    const permission = this.assertPermission(
      actor,
      permissionCode,
    );
    const obligationId = normalizeRequiredText(
      rawObligationId,
      "obligationId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      obligationId,
      async (session) => {
        const current = await this.requireObligation(
          obligationId,
          session,
        );
        await this.requireEligibleContract(
          current.contractRecordId,
          session,
        );
        const now = Date.now();
        const updated =
          await this.obligationRepository.transitionStatus(
            {
              obligationId,
              fromStatuses,
              toStatus,
              transition: transition(
                current.status,
                toStatus,
                actor.id,
                now,
                reason,
              ),
              updatedByActorId: actor.id,
              updatedAt: now,
            },
            session,
          );
        return this.finishTransition(
          actor,
          permission,
          operation,
          current,
          updated,
          session,
        );
      },
    );
  }

  private async finishTransition(
    actor: Actor,
    permission: PermissionContract,
    operation: AuthoritativeAdminMutationIdentity,
    current: ContractObligation,
    updated: ContractObligation | null,
    session: ClientSession,
  ): Promise<ContractObligationMutationResult> {
    if (!updated) {
      throw new ContractObligationStateError(
        `${operation} is not allowed from status ${current.status}`,
      );
    }
    await this.recordAudit(
      actor,
      permission,
      operation,
      updated,
      {
        previousStatus: current.status,
        nextStatus: updated.status,
      },
      session,
    );
    return toContractObligationView(updated);
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

  private async requireResponsibleOwner(
    employmentProfileId: string,
    session: ClientSession,
  ): Promise<void> {
    const owner =
      await this.employmentProfileReadonlyAccess.findById(
        employmentProfileId,
        session,
      );
    if (
      !owner ||
      (owner.employmentStatus !== "ACTIVE" &&
        owner.employmentStatus !== "ON_LEAVE")
    ) {
      throw new ContractRegistryInvalidOwnerReferenceError(
        `Responsible owner employment profile must be ACTIVE or ON_LEAVE: ${employmentProfileId}`,
      );
    }
  }

  private async requireObligation(
    obligationId: string,
    session: ClientSession,
  ): Promise<ContractObligation> {
    const obligation =
      await this.obligationRepository.findById(
        obligationId,
        session,
      );
    if (!obligation) {
      throw new ContractObligationNotFoundError(
        obligationId,
      );
    }
    return obligation;
  }

  private async allocateCode(
    timestamp: number,
    session: ClientSession,
  ): Promise<string> {
    const bucket = utcYearBucketFromTimestamp(timestamp);
    const policy = buildContractObligationCodePolicy(bucket);
    const maxExisting =
      await this.obligationRepository.findMaxGeneratedCodeSequence(
        policy,
        session,
      );
    await this.codeSequenceRepository.ensureAtLeast(
      policy.moduleKey,
      policy.bucket,
      maxExisting,
      session,
    );
    const next =
      await this.codeSequenceRepository.allocateNext(
        policy.moduleKey,
        policy.bucket,
        session,
      );
    return formatBusinessCode(policy, next);
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
    obligation: ContractObligation,
    metadata: Readonly<Record<string, unknown>>,
    session: ClientSession,
  ): Promise<void> {
    await this.audit.record(
      actor,
      permission,
      obligation.id,
      {
        mutationType: operation,
        targetId: obligation.id,
        targetType: "contract-obligation",
        actorId: actor.id,
        contractRecordId: obligation.contractRecordId,
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

function normalizeCreateCommand(
  command: CreateContractObligationCommand,
) {
  return {
    contractRecordId: normalizeRequiredText(
      command.contractRecordId,
      "contractRecordId",
    ),
    obligationType: parseObligationType(
      command.obligationType,
    ),
    title: normalizeRequiredText(
      command.title,
      "title",
      CONTRACT_OBLIGATION_TITLE_MAX_LENGTH,
    ),
    description: normalizeOptionalText(
      command.description,
      "description",
      CONTRACT_OBLIGATION_DESCRIPTION_MAX_LENGTH,
    ),
    dueDate: parseOptionalDate(command.dueDate, "dueDate"),
    responsibleOwnerEmploymentProfileId:
      normalizeRequiredText(
        command.responsibleOwnerEmploymentProfileId,
        "responsibleOwnerEmploymentProfileId",
      ),
    evidencePolicy: parseEvidencePolicy(
      command.evidencePolicy,
    ),
  };
}

function normalizeUpdateCommand(
  command: UpdateContractObligationCommand,
) {
  const result = {
    obligationId: normalizeRequiredText(
      command.obligationId,
      "obligationId",
    ),
    obligationType:
      command.obligationType === undefined
        ? undefined
        : parseObligationType(command.obligationType),
    title:
      command.title === undefined
        ? undefined
        : normalizeRequiredText(
            command.title,
            "title",
            CONTRACT_OBLIGATION_TITLE_MAX_LENGTH,
          ),
    description:
      command.description === undefined
        ? undefined
        : normalizeOptionalText(
            command.description,
            "description",
            CONTRACT_OBLIGATION_DESCRIPTION_MAX_LENGTH,
          ),
    dueDate:
      command.dueDate === undefined
        ? undefined
        : parseOptionalDate(command.dueDate, "dueDate"),
    responsibleOwnerEmploymentProfileId:
      command.responsibleOwnerEmploymentProfileId ===
      undefined
        ? undefined
        : normalizeRequiredText(
            command.responsibleOwnerEmploymentProfileId,
            "responsibleOwnerEmploymentProfileId",
          ),
    evidencePolicy:
      command.evidencePolicy === undefined
        ? undefined
        : parseEvidencePolicy(command.evidencePolicy),
  };

  if (
    Object.entries(result).every(
      ([key, value]) =>
        key === "obligationId" || value === undefined,
    )
  ) {
    throw new ContractObligationValidationError(
      "At least one obligation metadata field is required",
    );
  }
  return result;
}

function normalizeEvidenceRefs(
  refs:
    | readonly {
        readonly type: string;
        readonly label: string;
        readonly url?: string | null;
        readonly referenceId?: string | null;
      }[]
    | undefined,
): readonly ContractObligationEvidenceRef[] {
  if (refs === undefined) {
    return [];
  }
  if (!Array.isArray(refs)) {
    throw new ContractObligationValidationError(
      "evidenceRefs must be an array",
    );
  }
  if (refs.length > CONTRACT_OBLIGATION_EVIDENCE_REF_MAX_COUNT) {
    throw new ContractObligationValidationError(
      `evidenceRefs must contain at most ${CONTRACT_OBLIGATION_EVIDENCE_REF_MAX_COUNT} items`,
    );
  }

  return refs.map((ref, index) => {
    if (
      typeof ref !== "object" ||
      ref === null ||
      Array.isArray(ref)
    ) {
      throw new ContractObligationValidationError(
        `evidenceRefs[${index}] must be an object`,
      );
    }
    const type = normalizeEnum(
      ref.type,
      CONTRACT_OBLIGATION_EVIDENCE_REF_TYPES,
      `evidenceRefs[${index}].type`,
    );
    const label = normalizeRequiredText(
      ref.label,
      `evidenceRefs[${index}].label`,
      CONTRACT_OBLIGATION_EVIDENCE_REF_LABEL_MAX_LENGTH,
    );
    const url = normalizeOptionalText(
      ref.url,
      `evidenceRefs[${index}].url`,
      CONTRACT_OBLIGATION_EVIDENCE_REF_URL_MAX_LENGTH,
    );
    const referenceId = normalizeOptionalText(
      ref.referenceId,
      `evidenceRefs[${index}].referenceId`,
      CONTRACT_OBLIGATION_EVIDENCE_REF_REFERENCE_ID_MAX_LENGTH,
    );

    if (type === "URL") {
      if (!url || !isHttpUrl(url) || referenceId) {
        throw new ContractObligationValidationError(
          `evidenceRefs[${index}] URL references require a valid http(s) url and no referenceId`,
        );
      }
    } else if (!referenceId || url) {
      throw new ContractObligationValidationError(
        `evidenceRefs[${index}] non-URL references require referenceId and no url`,
      );
    }

    return {
      type,
      label,
      url,
      referenceId,
    };
  });
}

function normalizeEventEvidenceLinkIds(
  value: unknown,
): readonly string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ContractObligationValidationError(
      "eventEvidenceLinkIds must be an array",
    );
  }
  if (value.length > CONTRACT_OBLIGATION_EVIDENCE_REF_MAX_COUNT) {
    throw new ContractObligationValidationError(
      `eventEvidenceLinkIds must contain at most ${CONTRACT_OBLIGATION_EVIDENCE_REF_MAX_COUNT} items`,
    );
  }

  const seen = new Set<string>();
  return value.map((raw, index) => {
    const id = normalizeRequiredText(
      raw,
      `eventEvidenceLinkIds[${index}]`,
    );
    if (seen.has(id)) {
      throw new ContractObligationValidationError(
        "eventEvidenceLinkIds must not contain duplicates",
      );
    }
    seen.add(id);
    return id;
  });
}

function parseObligationType(
  value: unknown,
): ContractObligationType {
  return normalizeEnum(
    value,
    CONTRACT_OBLIGATION_TYPES,
    "obligationType",
  );
}

function parseEvidencePolicy(
  value: unknown,
): ContractObligationEvidencePolicy {
  return normalizeEnum(
    value,
    CONTRACT_OBLIGATION_EVIDENCE_POLICIES,
    "evidencePolicy",
  );
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== "string") {
    throw new ContractObligationValidationError(
      `${field} must be one of ${allowed.join(", ")}`,
    );
  }
  const normalized = value.trim().toUpperCase() as T;
  if (!allowed.includes(normalized)) {
    throw new ContractObligationValidationError(
      `${field} must be one of ${allowed.join(", ")}`,
    );
  }
  return normalized;
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

function normalizeOptionalText(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new ContractObligationValidationError(
      `${field} must be a string or null`,
    );
  }
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > maxLength) {
    throw new ContractObligationValidationError(
      `${field} must be at most ${maxLength} characters`,
    );
  }
  return normalized;
}

function normalizeReason(value: unknown): string {
  return normalizeRequiredText(
    value,
    "reason",
    CONTRACT_OBLIGATION_REASON_MAX_LENGTH,
  );
}

function parseOptionalDate(
  value: unknown,
  field: string,
): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new ContractObligationValidationError(
      `${field} must be a canonical calendar date`,
    );
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value.trim());
  if (!match) {
    throw new ContractObligationValidationError(
      `${field} must be a canonical calendar date`,
    );
  }
  const timestamp = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3])
  ) {
    throw new ContractObligationValidationError(
      `${field} must be a canonical calendar date`,
    );
  }
  return timestamp;
}

function transition(
  fromStatus: ContractObligationStatus,
  toStatus: ContractObligationStatus,
  actorId: string,
  occurredAt: number,
  reason: string | null,
) {
  return {
    fromStatus,
    toStatus,
    actorId,
    occurredAt,
    reason,
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
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
    "Contract obligation mutations require global Contract Registry scope",
  );
}

function assertAdminActorType(actor: Actor): void {
  PermissionGuard.assertAdminActor(actor);
}
