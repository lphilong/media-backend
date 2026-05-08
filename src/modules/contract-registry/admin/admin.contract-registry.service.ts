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
  ContractRegistryEmploymentProfileReadonlyAccess,
} from "@modules/contract-registry/domain/contract-registry-employment-profile-readonly-access";
import {
  ContractRegistryConflictError,
  ContractRegistryInvalidFileReferenceMetadataError,
  ContractRegistryInvalidLinkedEntityReferenceError,
  ContractRegistryInvalidOwnerReferenceError,
  ContractRegistryNotFoundError,
  ContractRegistryPermissionScopeError,
  ContractRegistryStateError,
  ContractRegistryValidationError,
} from "@modules/contract-registry/domain/contract-registry.errors";
import { ContractRegistryRepository } from "@modules/contract-registry/domain/contract-registry.repository";
import { ContractRegistryTalentReadonlyAccess } from "@modules/contract-registry/domain/contract-registry-talent-readonly-access";
import {
  CONTRACT_CONFIDENTIALITY_TIERS,
  CONTRACT_KINDS,
  CONTRACT_LINKED_ENTITY_KINDS,
  ContractConfidentialityTier,
  ContractKind,
  ContractLinkedEntityKind,
  ContractRecord,
  ContractRecordMutationView,
  ContractRecordStatus,
} from "@modules/contract-registry/domain/contract-registry.types";
import {
  ActivateContractRecordCommand,
  ArchiveContractRecordCommand,
  AssignContractRecordOwnerCommand,
  ContractRecordMutationResult,
  CreateContractRecordCommand,
  ExpireContractRecordCommand,
  MarkContractRecordPendingSignatureCommand,
  ReopenContractRecordDraftCommand,
  TerminateContractRecordCommand,
  UpdateContractRecordDraftCoreCommand,
  UpdateContractRecordFileReferenceCommand,
} from "@modules/contract-registry/shared/contract-registry.contracts";

type ContractRegistryMutationFailureClassification =
  | "validation"
  | "conflict"
  | "not_found"
  | "state_error"
  | "invalid_linked_entity_reference"
  | "invalid_owner_reference"
  | "invalid_file_reference_metadata"
  | "permission_scope"
  | "invariant"
  | "unknown";

interface NormalizedCreateCommand {
  readonly contractCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly contractKind: ContractKind;
  readonly linkedEntityKind: ContractLinkedEntityKind;
  readonly linkedEmploymentProfileId: string | null;
  readonly linkedTalentId: string | null;
  readonly ownerEmploymentProfileId: string;
  readonly confidentialityTier: ContractConfidentialityTier;
  readonly effectiveStartDate: number;
  readonly effectiveEndDate: number | null;
  readonly fileReferenceId: string | null;
  readonly fileDisplayName: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
}

interface NormalizedUpdateDraftCoreCommand {
  readonly contractRecordId: string;
  readonly title?: string;
  readonly normalizedTitle?: string;
  readonly linkedEntityKind?: ContractLinkedEntityKind;
  readonly linkedEmploymentProfileId?: string | null;
  readonly linkedTalentId?: string | null;
  readonly confidentialityTier?: ContractConfidentialityTier;
  readonly effectiveStartDate?: number;
  readonly effectiveEndDate?: number | null;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

interface NormalizedAssignOwnerCommand {
  readonly contractRecordId: string;
  readonly newOwnerEmploymentProfileId: string;
}

interface NormalizedUpdateFileReferenceCommand {
  readonly contractRecordId: string;
  readonly newFileReferenceId: string | null;
  readonly newFileDisplayName: string | null;
}

interface NormalizedLifecycleCommand {
  readonly contractRecordId: string;
}

interface NormalizedExpireCommand {
  readonly contractRecordId: string;
  readonly expiryDate: number;
}

interface NormalizedTerminateCommand {
  readonly contractRecordId: string;
  readonly terminationDate: number;
}

interface ContractRecordCandidateState {
  contractKind: ContractKind;
  linkedEntityKind: ContractLinkedEntityKind;
  linkedEmploymentProfileId: string | null;
  linkedTalentId: string | null;
  ownerEmploymentProfileId: string;
  effectiveStartDate: number;
  effectiveEndDate: number | null;
  fileReferenceId: string | null;
  fileDisplayName: string | null;
}

interface DraftCorePatchBuildResult {
  readonly update: {
    readonly contractRecordId: string;
    readonly title?: string;
    readonly normalizedTitle?: string;
    readonly linkedEntityKind?: ContractLinkedEntityKind;
    readonly linkedEmploymentProfileId?: string | null;
    readonly linkedTalentId?: string | null;
    readonly confidentialityTier?: ContractConfidentialityTier;
    readonly effectiveStartDate?: number;
    readonly effectiveEndDate?: number | null;
    readonly description?: string | null;
    readonly externalRef?: string | null;
    readonly updatedAt: number;
  };
  readonly candidate: ContractRecordCandidateState;
  readonly changedFields: readonly string[];
}

export class ContractRegistryAdminService {
  constructor(
    private readonly repository: ContractRegistryRepository,
    private readonly employmentProfileReadonlyAccess: ContractRegistryEmploymentProfileReadonlyAccess,
    private readonly talentReadonlyAccess: ContractRegistryTalentReadonlyAccess,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly logger: StructuredLogger = createStructuredLogger(),
  ) {}

  async createContractRecord(
    actor: Actor,
    command: CreateContractRecordCommand,
  ): Promise<ContractRecordMutationResult> {
    const operation = "contract-registry.create";
    const permission = this.assertPermission(
      actor,
      Permission.CONTRACT_REGISTRY_CREATE,
    );
    const input = normalizeCreateCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        contractCode: input.contractCode,
        contractKind: input.contractKind,
        linkedEntityKind: input.linkedEntityKind,
        ownerEmploymentProfileId:
          input.ownerEmploymentProfileId,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(actor);
        const existingByCode =
          await this.repository.findByContractCode(
            input.contractCode,
            session,
          );

        if (existingByCode) {
          throw new ContractRegistryConflictError(
            `Contract code already exists: ${input.contractCode}`,
          );
        }

        assertLinkedEntityReferenceShape(
          input.linkedEntityKind,
          input.linkedEmploymentProfileId,
          input.linkedTalentId,
        );
        assertContractKindCompatibility(
          input.contractKind,
          input.linkedEntityKind,
        );
        await this.assertLinkedEntityEligible(
          input.linkedEntityKind,
          input.linkedEmploymentProfileId,
          input.linkedTalentId,
          session,
        );
        await this.assertOwnerEligible(
          input.ownerEmploymentProfileId,
          session,
        );
        assertFileReferenceMetadataRule(
          input.fileReferenceId,
          input.fileDisplayName,
        );
        assertEffectiveWindowRule(
          input.effectiveStartDate,
          input.effectiveEndDate,
        );

        const now = Date.now();
        const record: ContractRecord = {
          id: crypto.randomUUID(),
          contractCode: input.contractCode,
          title: input.title,
          normalizedTitle: input.normalizedTitle,
          contractKind: input.contractKind,
          linkedEntityKind: input.linkedEntityKind,
          linkedEmploymentProfileId:
            input.linkedEmploymentProfileId,
          linkedTalentId: input.linkedTalentId,
          ownerEmploymentProfileId:
            input.ownerEmploymentProfileId,
          confidentialityTier:
            input.confidentialityTier,
          status: "DRAFT",
          effectiveStartDate:
            input.effectiveStartDate,
          effectiveEndDate: input.effectiveEndDate,
          fileReferenceId: input.fileReferenceId,
          fileDisplayName: input.fileDisplayName,
          description: input.description,
          externalRef: input.externalRef,
          createdAt: now,
          updatedAt: now,
        };

        let created: ContractRecord;

        try {
          created = await this.repository.insert(
            record,
            session,
          );
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            throw new ContractRegistryConflictError(
              `Contract code already exists: ${input.contractCode}`,
            );
          }

          throw error;
        }

        await this.recordAudit({
          actor,
          permission,
          contractRecordId: created.id,
          mutationType: operation,
          metadata: {
            contractCode: created.contractCode,
            contractKind: created.contractKind,
            linkedEntityKind:
              created.linkedEntityKind,
            linkedEmploymentProfileId:
              created.linkedEmploymentProfileId,
            linkedTalentId:
              created.linkedTalentId,
            ownerEmploymentProfileId:
              created.ownerEmploymentProfileId,
            confidentialityTier:
              created.confidentialityTier,
            effectiveScope: scope,
          },
          session,
        });

        return toContractRecordMutationView(created);
      },
      (result) => ({
        contractRecordId: result.id,
        status: result.status,
      }),
    );
  }

  async updateContractRecordDraftCore(
    actor: Actor,
    command: UpdateContractRecordDraftCoreCommand,
  ): Promise<ContractRecordMutationResult> {
    const operation =
      "contract-registry.update-draft-core";
    const permission = this.assertPermission(
      actor,
      Permission.CONTRACT_REGISTRY_UPDATE,
    );
    const input =
      normalizeUpdateDraftCoreCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        contractRecordId: input.contractRecordId,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current =
          await this.requireContractRecord(
            input.contractRecordId,
            session,
          );

        assertStatusIn(
          current.status,
          ["DRAFT", "PENDING_SIGNATURE"],
          `${operation} requires status DRAFT or PENDING_SIGNATURE`,
        );

        assertContractRecordStructuralInvariants(
          current,
        );
        const patch = buildDraftCorePatch({
          current,
          command: input,
        });

        if (patch.changedFields.length === 0) {
          throw new ContractRegistryValidationError(
            "At least one changed field is required",
          );
        }

        assertLinkedEntityReferenceShape(
          patch.candidate.linkedEntityKind,
          patch.candidate.linkedEmploymentProfileId,
          patch.candidate.linkedTalentId,
        );
        assertContractKindCompatibility(
          patch.candidate.contractKind,
          patch.candidate.linkedEntityKind,
        );
        await this.assertLinkedEntityEligible(
          patch.candidate.linkedEntityKind,
          patch.candidate.linkedEmploymentProfileId,
          patch.candidate.linkedTalentId,
          session,
        );
        assertEffectiveWindowRule(
          patch.candidate.effectiveStartDate,
          patch.candidate.effectiveEndDate,
        );
        assertFileReferenceMetadataRule(
          patch.candidate.fileReferenceId,
          patch.candidate.fileDisplayName,
        );

        const updated =
          await this.repository.updateDraftCore(
            patch.update,
            session,
          );

        if (!updated) {
          throw new ContractRegistryStateError(
            `updateContractRecordDraftCore failed because record state changed during execution: ${input.contractRecordId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          contractRecordId: updated.id,
          mutationType: operation,
          metadata: {
            changedFields: patch.changedFields,
            effectiveScope: scope,
          },
          session,
        });

        return toContractRecordMutationView(updated);
      },
      (result) => ({
        contractRecordId: result.id,
        status: result.status,
      }),
    );
  }

  async assignContractRecordOwner(
    actor: Actor,
    command: AssignContractRecordOwnerCommand,
  ): Promise<ContractRecordMutationResult> {
    const operation = "contract-registry.assign-owner";
    const permission = this.assertPermission(
      actor,
      Permission.CONTRACT_REGISTRY_MANAGE_OWNER,
    );
    const input = normalizeAssignOwnerCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        contractRecordId: input.contractRecordId,
        newOwnerEmploymentProfileId:
          input.newOwnerEmploymentProfileId,
      },
      async (session, controls) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current =
          await this.requireContractRecord(
            input.contractRecordId,
            session,
          );

        if (current.status === "ARCHIVED") {
          throw new ContractRegistryStateError(
            `Archived contract record cannot change owner: ${current.id}`,
          );
        }

        assertContractRecordStructuralInvariants(
          current,
        );
        await this.assertOwnerEligible(
          input.newOwnerEmploymentProfileId,
          session,
        );

        if (
          current.ownerEmploymentProfileId ===
          input.newOwnerEmploymentProfileId
        ) {
          controls.markExplicitNoOpSuccess();
          return toContractRecordMutationView(current);
        }

        const updated =
          await this.repository.assignOwner(
            {
              contractRecordId: current.id,
              ownerEmploymentProfileId:
                input.newOwnerEmploymentProfileId,
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new ContractRegistryStateError(
            `assignContractRecordOwner failed because record is no longer mutable in current state: ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          contractRecordId: updated.id,
          mutationType: operation,
          metadata: {
            previousOwnerEmploymentProfileId:
              current.ownerEmploymentProfileId,
            newOwnerEmploymentProfileId:
              updated.ownerEmploymentProfileId,
            effectiveScope: scope,
          },
          session,
        });

        return toContractRecordMutationView(updated);
      },
      (result) => ({
        contractRecordId: result.id,
        ownerEmploymentProfileId:
          result.ownerEmploymentProfileId,
      }),
    );
  }

  async updateContractRecordFileReference(
    actor: Actor,
    command: UpdateContractRecordFileReferenceCommand,
  ): Promise<ContractRecordMutationResult> {
    const operation =
      "contract-registry.update-file-reference";
    const permission = this.assertPermission(
      actor,
      Permission.CONTRACT_REGISTRY_MANAGE_FILE_REFERENCE,
    );
    const input =
      normalizeUpdateFileReferenceCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        contractRecordId: input.contractRecordId,
      },
      async (session, controls) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current =
          await this.requireContractRecord(
            input.contractRecordId,
            session,
          );

        if (current.status === "ARCHIVED") {
          throw new ContractRegistryStateError(
            `Archived contract record cannot change file reference metadata: ${current.id}`,
          );
        }

        assertContractRecordStructuralInvariants(
          current,
        );
        assertFileReferenceMetadataRule(
          input.newFileReferenceId,
          input.newFileDisplayName,
        );

        if (
          current.fileReferenceId ===
            input.newFileReferenceId &&
          current.fileDisplayName ===
            input.newFileDisplayName
        ) {
          controls.markExplicitNoOpSuccess();
          return toContractRecordMutationView(current);
        }

        const updated =
          await this.repository.updateFileReference(
            {
              contractRecordId: current.id,
              fileReferenceId:
                input.newFileReferenceId,
              fileDisplayName:
                input.newFileDisplayName,
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new ContractRegistryStateError(
            `updateContractRecordFileReference failed because record is no longer mutable in current state: ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          contractRecordId: updated.id,
          mutationType: operation,
          metadata: {
            previousFileReferenceId:
              current.fileReferenceId,
            previousFileDisplayName:
              current.fileDisplayName,
            newFileReferenceId:
              updated.fileReferenceId,
            newFileDisplayName:
              updated.fileDisplayName,
            effectiveScope: scope,
          },
          session,
        });

        return toContractRecordMutationView(updated);
      },
      (result) => ({
        contractRecordId: result.id,
        fileReferenceId: result.fileReferenceId,
      }),
    );
  }

  async markContractRecordPendingSignature(
    actor: Actor,
    command: MarkContractRecordPendingSignatureCommand,
  ): Promise<ContractRecordMutationResult> {
    const operation =
      "contract-registry.mark-pending-signature";
    const permission = this.assertPermission(
      actor,
      Permission.CONTRACT_REGISTRY_MANAGE_LIFECYCLE,
    );
    const input = normalizeLifecycleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        contractRecordId: input.contractRecordId,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current =
          await this.requireContractRecord(
            input.contractRecordId,
            session,
          );

        if (current.status !== "DRAFT") {
          throw new ContractRegistryStateError(
            `${operation} requires status DRAFT, received ${current.status}`,
          );
        }

        assertContractRecordStructuralInvariants(
          current,
        );

        const updated =
          await this.repository.transitionStatus(
            {
              contractRecordId: current.id,
              fromStatuses: ["DRAFT"],
              toStatus: "PENDING_SIGNATURE",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new ContractRegistryStateError(
            `${operation} failed because record state changed during execution`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          contractRecordId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            effectiveScope: scope,
          },
          session,
        });

        return toContractRecordMutationView(updated);
      },
      (result) => ({
        contractRecordId: result.id,
        status: result.status,
      }),
    );
  }

  async reopenContractRecordDraft(
    actor: Actor,
    command: ReopenContractRecordDraftCommand,
  ): Promise<ContractRecordMutationResult> {
    const operation = "contract-registry.reopen-draft";
    const permission = this.assertPermission(
      actor,
      Permission.CONTRACT_REGISTRY_MANAGE_LIFECYCLE,
    );
    const input = normalizeLifecycleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        contractRecordId: input.contractRecordId,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current =
          await this.requireContractRecord(
            input.contractRecordId,
            session,
          );

        if (current.status !== "PENDING_SIGNATURE") {
          throw new ContractRegistryStateError(
            `${operation} requires status PENDING_SIGNATURE, received ${current.status}`,
          );
        }

        assertContractRecordStructuralInvariants(
          current,
        );

        const updated =
          await this.repository.transitionStatus(
            {
              contractRecordId: current.id,
              fromStatuses: [
                "PENDING_SIGNATURE",
              ],
              toStatus: "DRAFT",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new ContractRegistryStateError(
            `${operation} failed because record state changed during execution`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          contractRecordId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            effectiveScope: scope,
          },
          session,
        });

        return toContractRecordMutationView(updated);
      },
      (result) => ({
        contractRecordId: result.id,
        status: result.status,
      }),
    );
  }

  async activateContractRecord(
    actor: Actor,
    command: ActivateContractRecordCommand,
  ): Promise<ContractRecordMutationResult> {
    const operation = "contract-registry.activate";
    const permission = this.assertPermission(
      actor,
      Permission.CONTRACT_REGISTRY_MANAGE_LIFECYCLE,
    );
    const input = normalizeLifecycleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        contractRecordId: input.contractRecordId,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current =
          await this.requireContractRecord(
            input.contractRecordId,
            session,
          );

        assertStatusIn(
          current.status,
          ["DRAFT", "PENDING_SIGNATURE"],
          `${operation} requires status DRAFT or PENDING_SIGNATURE`,
        );

        assertContractRecordStructuralInvariants(
          current,
        );
        const evaluationDate =
          currentEvaluationDate();

        await this.assertLinkedEntityEligible(
          current.linkedEntityKind,
          current.linkedEmploymentProfileId,
          current.linkedTalentId,
          session,
        );
        await this.assertOwnerEligible(
          current.ownerEmploymentProfileId,
          session,
        );
        assertEvaluationDateWithinEffectiveWindow(
          current.effectiveStartDate,
          current.effectiveEndDate,
          evaluationDate,
        );

        const updated =
          await this.repository.transitionStatus(
            {
              contractRecordId: current.id,
              fromStatuses: [
                "DRAFT",
                "PENDING_SIGNATURE",
              ],
              toStatus: "ACTIVE",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new ContractRegistryStateError(
            `${operation} failed because record state changed during execution`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          contractRecordId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            linkedEntityKind:
              current.linkedEntityKind,
            linkedEmploymentProfileId:
              current.linkedEmploymentProfileId,
            linkedTalentId:
              current.linkedTalentId,
            ownerEmploymentProfileId:
              current.ownerEmploymentProfileId,
            confidentialityTier:
              current.confidentialityTier,
            effectiveStartDate:
              current.effectiveStartDate,
            effectiveEndDate:
              current.effectiveEndDate,
            evaluationDate,
            effectiveScope: scope,
          },
          session,
        });

        return toContractRecordMutationView(updated);
      },
      (result) => ({
        contractRecordId: result.id,
        status: result.status,
      }),
    );
  }

  async expireContractRecord(
    actor: Actor,
    command: ExpireContractRecordCommand,
  ): Promise<ContractRecordMutationResult> {
    const operation = "contract-registry.expire";
    const permission = this.assertPermission(
      actor,
      Permission.CONTRACT_REGISTRY_MANAGE_LIFECYCLE,
    );
    const input = normalizeExpireCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        contractRecordId: input.contractRecordId,
        expiryDate: input.expiryDate,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current =
          await this.requireContractRecord(
            input.contractRecordId,
            session,
          );

        if (current.status !== "ACTIVE") {
          throw new ContractRegistryStateError(
            `${operation} requires status ACTIVE, received ${current.status}`,
          );
        }

        assertContractRecordStructuralInvariants(
          current,
        );
        const evaluationDate =
          currentEvaluationDate();
        assertLifecycleDateMutationAllowed({
          mutationField: "expiryDate",
          mutationDate: input.expiryDate,
          effectiveStartDate:
            current.effectiveStartDate,
          currentEffectiveEndDate:
            current.effectiveEndDate,
          evaluationDate,
        });

        const updated =
          await this.repository.transitionStatus(
            {
              contractRecordId: current.id,
              fromStatuses: ["ACTIVE"],
              toStatus: "EXPIRED",
              effectiveEndDate: input.expiryDate,
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new ContractRegistryStateError(
            `${operation} failed because record state changed during execution`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          contractRecordId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            previousEffectiveEndDate:
              current.effectiveEndDate,
            newEffectiveEndDate:
              updated.effectiveEndDate,
            evaluationDate,
            effectiveScope: scope,
          },
          session,
        });

        return toContractRecordMutationView(updated);
      },
      (result) => ({
        contractRecordId: result.id,
        status: result.status,
        effectiveEndDate: result.effectiveEndDate,
      }),
    );
  }

  async terminateContractRecord(
    actor: Actor,
    command: TerminateContractRecordCommand,
  ): Promise<ContractRecordMutationResult> {
    const operation = "contract-registry.terminate";
    const permission = this.assertPermission(
      actor,
      Permission.CONTRACT_REGISTRY_MANAGE_LIFECYCLE,
    );
    const input = normalizeTerminateCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        contractRecordId: input.contractRecordId,
        terminationDate: input.terminationDate,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current =
          await this.requireContractRecord(
            input.contractRecordId,
            session,
          );

        if (current.status !== "ACTIVE") {
          throw new ContractRegistryStateError(
            `${operation} requires status ACTIVE, received ${current.status}`,
          );
        }

        assertContractRecordStructuralInvariants(
          current,
        );
        const evaluationDate =
          currentEvaluationDate();
        assertLifecycleDateMutationAllowed({
          mutationField: "terminationDate",
          mutationDate: input.terminationDate,
          effectiveStartDate:
            current.effectiveStartDate,
          currentEffectiveEndDate:
            current.effectiveEndDate,
          evaluationDate,
        });

        const updated =
          await this.repository.transitionStatus(
            {
              contractRecordId: current.id,
              fromStatuses: ["ACTIVE"],
              toStatus: "TERMINATED",
              effectiveEndDate:
                input.terminationDate,
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new ContractRegistryStateError(
            `${operation} failed because record state changed during execution`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          contractRecordId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            previousEffectiveEndDate:
              current.effectiveEndDate,
            newEffectiveEndDate:
              updated.effectiveEndDate,
            evaluationDate,
            effectiveScope: scope,
          },
          session,
        });

        return toContractRecordMutationView(updated);
      },
      (result) => ({
        contractRecordId: result.id,
        status: result.status,
        effectiveEndDate: result.effectiveEndDate,
      }),
    );
  }

  async archiveContractRecord(
    actor: Actor,
    command: ArchiveContractRecordCommand,
  ): Promise<ContractRecordMutationResult> {
    const operation = "contract-registry.archive";
    const permission = this.assertPermission(
      actor,
      Permission.CONTRACT_REGISTRY_MANAGE_LIFECYCLE,
    );
    const input = normalizeLifecycleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        contractRecordId: input.contractRecordId,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current =
          await this.requireContractRecord(
            input.contractRecordId,
            session,
          );

        assertStatusIn(
          current.status,
          [
            "DRAFT",
            "PENDING_SIGNATURE",
            "EXPIRED",
            "TERMINATED",
          ],
          `${operation} requires status DRAFT, PENDING_SIGNATURE, EXPIRED, or TERMINATED`,
        );

        assertContractRecordStructuralInvariants(
          current,
        );

        const updated =
          await this.repository.transitionStatus(
            {
              contractRecordId: current.id,
              fromStatuses: [current.status],
              toStatus: "ARCHIVED",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new ContractRegistryStateError(
            `${operation} failed because record state changed during execution`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          contractRecordId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            effectiveScope: scope,
          },
          session,
        });

        return toContractRecordMutationView(updated);
      },
      (result) => ({
        contractRecordId: result.id,
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

  private async requireContractRecord(
    contractRecordId: string,
    session: ClientSession,
  ): Promise<ContractRecord> {
    const record = await this.repository.findById(
      contractRecordId,
      session,
    );

    if (!record) {
      throw new ContractRegistryNotFoundError(
        contractRecordId,
      );
    }

    return record;
  }

  private async assertLinkedEntityEligible(
    linkedEntityKind: ContractLinkedEntityKind,
    linkedEmploymentProfileId: string | null,
    linkedTalentId: string | null,
    session: ClientSession,
  ): Promise<void> {
    if (linkedEntityKind === "EMPLOYMENT_PROFILE") {
      if (!linkedEmploymentProfileId) {
        throw new ContractRegistryInvalidLinkedEntityReferenceError(
          "linkedEmploymentProfileId is required when linkedEntityKind is EMPLOYMENT_PROFILE",
        );
      }

      const employmentProfile =
        await this.employmentProfileReadonlyAccess.findById(
          linkedEmploymentProfileId,
          session,
        );

      if (!employmentProfile) {
        throw new ContractRegistryInvalidLinkedEntityReferenceError(
          `Linked employment profile does not exist: ${linkedEmploymentProfileId}`,
        );
      }

      if (
        employmentProfile.employmentStatus ===
        "ARCHIVED"
      ) {
        throw new ContractRegistryInvalidLinkedEntityReferenceError(
          `Linked employment profile must not be ARCHIVED: ${linkedEmploymentProfileId}`,
        );
      }

      return;
    }

    if (!linkedTalentId) {
      throw new ContractRegistryInvalidLinkedEntityReferenceError(
        "linkedTalentId is required when linkedEntityKind is TALENT",
      );
    }

    const talent = await this.talentReadonlyAccess.findById(
      linkedTalentId,
      session,
    );

    if (!talent) {
      throw new ContractRegistryInvalidLinkedEntityReferenceError(
        `Linked talent does not exist: ${linkedTalentId}`,
      );
    }

    if (talent.operationalStatus === "ARCHIVED") {
      throw new ContractRegistryInvalidLinkedEntityReferenceError(
        `Linked talent must not be ARCHIVED: ${linkedTalentId}`,
      );
    }
  }

  private async assertOwnerEligible(
    ownerEmploymentProfileId: string,
    session: ClientSession,
  ): Promise<void> {
    const owner =
      await this.employmentProfileReadonlyAccess.findById(
        ownerEmploymentProfileId,
        session,
      );

    if (!owner) {
      throw new ContractRegistryInvalidOwnerReferenceError(
        `Owner employment profile does not exist: ${ownerEmploymentProfileId}`,
      );
    }

    if (
      owner.employmentStatus !== "ACTIVE" &&
      owner.employmentStatus !== "ON_LEAVE"
    ) {
      throw new ContractRegistryInvalidOwnerReferenceError(
        `Owner employment profile must be ACTIVE or ON_LEAVE: ${ownerEmploymentProfileId}`,
      );
    }
  }

  private async recordAudit(params: {
    readonly actor: Actor;
    readonly permission: PermissionContract;
    readonly contractRecordId: string;
    readonly mutationType: AuthoritativeAdminMutationIdentity;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly session: ClientSession;
  }): Promise<void> {
    await this.audit.record(
      params.actor,
      params.permission,
      params.contractRecordId,
      {
        mutationType: params.mutationType,
        targetId: params.contractRecordId,
        targetType: "contract-record",
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
            classifyContractRegistryMutationFailure(
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

function normalizeCreateCommand(
  command: CreateContractRecordCommand,
): NormalizedCreateCommand {
  const title = normalizeDisplayText(
    command.title,
    "title",
  );

  return {
    contractCode: normalizeRequiredText(
      command.contractCode,
      "contractCode",
    ),
    title,
    normalizedTitle: canonicalizeSearchToken(title),
    contractKind: normalizeContractKind(
      command.contractKind,
    ),
    linkedEntityKind: normalizeLinkedEntityKind(
      command.linkedEntityKind,
    ),
    linkedEmploymentProfileId:
      normalizeOptionalNullableId(
        command.linkedEmploymentProfileId,
        "linkedEmploymentProfileId",
        {
          missingAsNull: true,
        },
      ),
    linkedTalentId: normalizeOptionalNullableId(
      command.linkedTalentId,
      "linkedTalentId",
      {
        missingAsNull: true,
      },
    ),
    ownerEmploymentProfileId: normalizeRequiredText(
      command.ownerEmploymentProfileId,
      "ownerEmploymentProfileId",
    ),
    confidentialityTier:
      normalizeConfidentialityTier(
        command.confidentialityTier,
      ),
    effectiveStartDate:
      normalizeRequiredCanonicalCalendarDateValue(
        command.effectiveStartDate,
        "effectiveStartDate",
      ),
    effectiveEndDate:
      normalizeOptionalNullableCanonicalCalendarDateValue(
        command.effectiveEndDate,
        "effectiveEndDate",
        {
          missingAsNull: true,
        },
      ),
    fileReferenceId: normalizeOptionalNullableId(
      command.fileReferenceId,
      "fileReferenceId",
      {
        missingAsNull: true,
      },
    ),
    fileDisplayName:
      normalizeOptionalNullableDisplayText(
        command.fileDisplayName,
        "fileDisplayName",
        {
          missingAsNull: true,
        },
      ),
    description:
      normalizeOptionalNullableText(
        command.description,
        "description",
        {
          missingAsNull: true,
        },
      ),
    externalRef: normalizeOptionalNullableText(
      command.externalRef,
      "externalRef",
      {
        missingAsNull: true,
      },
    ),
  };
}

function normalizeUpdateDraftCoreCommand(
  command: UpdateContractRecordDraftCoreCommand,
): NormalizedUpdateDraftCoreCommand {
  return {
    contractRecordId: normalizeRequiredText(
      command.contractRecordId,
      "contractRecordId",
    ),
    title: normalizeOptionalNonNullableDisplayText(
      command.title,
      "title",
    ),
    normalizedTitle:
      command.title !== undefined
        ? canonicalizeSearchToken(
            normalizeOptionalNonNullableDisplayText(
              command.title,
              "title",
            ) as string,
          )
        : undefined,
    linkedEntityKind:
      normalizeOptionalLinkedEntityKind(
        command.linkedEntityKind,
      ),
    linkedEmploymentProfileId:
      normalizeOptionalNullableId(
        command.linkedEmploymentProfileId,
        "linkedEmploymentProfileId",
        {
          missingAsNull: false,
        },
      ),
    linkedTalentId: normalizeOptionalNullableId(
      command.linkedTalentId,
      "linkedTalentId",
      {
        missingAsNull: false,
      },
    ),
    confidentialityTier:
      normalizeOptionalConfidentialityTier(
        command.confidentialityTier,
      ),
    effectiveStartDate:
      normalizeOptionalCanonicalCalendarDateValue(
        command.effectiveStartDate,
        "effectiveStartDate",
      ),
    effectiveEndDate:
      normalizeOptionalNullableCanonicalCalendarDateValue(
        command.effectiveEndDate,
        "effectiveEndDate",
        {
          missingAsNull: false,
        },
      ),
    description:
      normalizeOptionalNullableText(
        command.description,
        "description",
        {
          missingAsNull: false,
        },
      ),
    externalRef: normalizeOptionalNullableText(
      command.externalRef,
      "externalRef",
      {
        missingAsNull: false,
      },
    ),
  };
}

function normalizeAssignOwnerCommand(
  command: AssignContractRecordOwnerCommand,
): NormalizedAssignOwnerCommand {
  return {
    contractRecordId: normalizeRequiredText(
      command.contractRecordId,
      "contractRecordId",
    ),
    newOwnerEmploymentProfileId:
      normalizeRequiredText(
        command.newOwnerEmploymentProfileId,
        "newOwnerEmploymentProfileId",
      ),
  };
}

function normalizeUpdateFileReferenceCommand(
  command: UpdateContractRecordFileReferenceCommand,
): NormalizedUpdateFileReferenceCommand {
  return {
    contractRecordId: normalizeRequiredText(
      command.contractRecordId,
      "contractRecordId",
    ),
    newFileReferenceId: normalizeRequiredNullableId(
      command.newFileReferenceId,
      "newFileReferenceId",
    ),
    newFileDisplayName:
      normalizeRequiredNullableDisplayText(
        command.newFileDisplayName,
        "newFileDisplayName",
      ),
  };
}

function normalizeLifecycleCommand(
  command:
    | MarkContractRecordPendingSignatureCommand
    | ReopenContractRecordDraftCommand
    | ActivateContractRecordCommand
    | ArchiveContractRecordCommand,
): NormalizedLifecycleCommand {
  return {
    contractRecordId: normalizeRequiredText(
      command.contractRecordId,
      "contractRecordId",
    ),
  };
}

function normalizeExpireCommand(
  command: ExpireContractRecordCommand,
): NormalizedExpireCommand {
  return {
    contractRecordId: normalizeRequiredText(
      command.contractRecordId,
      "contractRecordId",
    ),
    expiryDate:
      normalizeRequiredCanonicalCalendarDateValue(
        command.expiryDate,
        "expiryDate",
      ),
  };
}

function normalizeTerminateCommand(
  command: TerminateContractRecordCommand,
): NormalizedTerminateCommand {
  return {
    contractRecordId: normalizeRequiredText(
      command.contractRecordId,
      "contractRecordId",
    ),
    terminationDate:
      normalizeRequiredCanonicalCalendarDateValue(
        command.terminationDate,
        "terminationDate",
      ),
  };
}

function buildDraftCorePatch(params: {
  readonly current: ContractRecord;
  readonly command: NormalizedUpdateDraftCoreCommand;
}): DraftCorePatchBuildResult {
  const changedFields: string[] = [];
  const candidate: ContractRecordCandidateState = {
    contractKind: params.current.contractKind,
    linkedEntityKind:
      params.current.linkedEntityKind,
    linkedEmploymentProfileId:
      params.current.linkedEmploymentProfileId,
    linkedTalentId: params.current.linkedTalentId,
    ownerEmploymentProfileId:
      params.current.ownerEmploymentProfileId,
    effectiveStartDate:
      params.current.effectiveStartDate,
    effectiveEndDate: params.current.effectiveEndDate,
    fileReferenceId: params.current.fileReferenceId,
    fileDisplayName: params.current.fileDisplayName,
  };

  const update: {
    contractRecordId: string;
    updatedAt: number;
    title?: string;
    normalizedTitle?: string;
    linkedEntityKind?: ContractLinkedEntityKind;
    linkedEmploymentProfileId?: string | null;
    linkedTalentId?: string | null;
    confidentialityTier?: ContractConfidentialityTier;
    effectiveStartDate?: number;
    effectiveEndDate?: number | null;
    description?: string | null;
    externalRef?: string | null;
  } = {
    contractRecordId: params.current.id,
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
    params.command.linkedEntityKind !== undefined &&
    params.command.linkedEntityKind !==
      params.current.linkedEntityKind
  ) {
    update.linkedEntityKind =
      params.command.linkedEntityKind;
    candidate.linkedEntityKind =
      params.command.linkedEntityKind;
    changedFields.push("linkedEntityKind");
  }

  if (
    params.command.linkedEmploymentProfileId !==
      undefined &&
    params.command.linkedEmploymentProfileId !==
      params.current.linkedEmploymentProfileId
  ) {
    update.linkedEmploymentProfileId =
      params.command.linkedEmploymentProfileId;
    candidate.linkedEmploymentProfileId =
      params.command.linkedEmploymentProfileId;
    changedFields.push(
      "linkedEmploymentProfileId",
    );
  }

  if (
    params.command.linkedTalentId !== undefined &&
    params.command.linkedTalentId !==
      params.current.linkedTalentId
  ) {
    update.linkedTalentId =
      params.command.linkedTalentId;
    candidate.linkedTalentId =
      params.command.linkedTalentId;
    changedFields.push("linkedTalentId");
  }

  if (
    params.command.confidentialityTier !==
      undefined &&
    params.command.confidentialityTier !==
      params.current.confidentialityTier
  ) {
    update.confidentialityTier =
      params.command.confidentialityTier;
    changedFields.push("confidentialityTier");
  }

  if (
    params.command.effectiveStartDate !==
      undefined &&
    params.command.effectiveStartDate !==
      params.current.effectiveStartDate
  ) {
    update.effectiveStartDate =
      params.command.effectiveStartDate;
    candidate.effectiveStartDate =
      params.command.effectiveStartDate;
    changedFields.push("effectiveStartDate");
  }

  if (
    params.command.effectiveEndDate !== undefined &&
    params.command.effectiveEndDate !==
      params.current.effectiveEndDate
  ) {
    update.effectiveEndDate =
      params.command.effectiveEndDate;
    candidate.effectiveEndDate =
      params.command.effectiveEndDate;
    changedFields.push("effectiveEndDate");
  }

  if (
    params.command.description !== undefined &&
    params.command.description !==
      params.current.description
  ) {
    update.description = params.command.description;
    changedFields.push("description");
  }

  if (
    params.command.externalRef !== undefined &&
    params.command.externalRef !==
      params.current.externalRef
  ) {
    update.externalRef = params.command.externalRef;
    changedFields.push("externalRef");
  }

  return {
    update,
    candidate,
    changedFields,
  };
}

function assertStatusIn(
  status: ContractRecordStatus,
  allowed: readonly ContractRecordStatus[],
  message: string,
): void {
  if (allowed.includes(status)) {
    return;
  }

  throw new ContractRegistryStateError(message);
}

function assertContractRecordStructuralInvariants(
  record: ContractRecord,
): void {
  assertLinkedEntityReferenceShape(
    record.linkedEntityKind,
    record.linkedEmploymentProfileId,
    record.linkedTalentId,
  );
  assertContractKindCompatibility(
    record.contractKind,
    record.linkedEntityKind,
  );
  assertFileReferenceMetadataRule(
    record.fileReferenceId,
    record.fileDisplayName,
  );
  assertEffectiveWindowRule(
    record.effectiveStartDate,
    record.effectiveEndDate,
  );
}

function assertLinkedEntityReferenceShape(
  linkedEntityKind: ContractLinkedEntityKind,
  linkedEmploymentProfileId: string | null,
  linkedTalentId: string | null,
): void {
  if (linkedEntityKind === "EMPLOYMENT_PROFILE") {
    if (
      linkedEmploymentProfileId !== null &&
      linkedTalentId === null
    ) {
      return;
    }

    throw new ContractRegistryInvalidLinkedEntityReferenceError(
      "linkedEntityKind EMPLOYMENT_PROFILE requires linkedEmploymentProfileId and forbids linkedTalentId",
    );
  }

  if (
    linkedTalentId !== null &&
    linkedEmploymentProfileId === null
  ) {
    return;
  }

  throw new ContractRegistryInvalidLinkedEntityReferenceError(
    "linkedEntityKind TALENT requires linkedTalentId and forbids linkedEmploymentProfileId",
  );
}

function assertContractKindCompatibility(
  contractKind: ContractKind,
  linkedEntityKind: ContractLinkedEntityKind,
): void {
  if (
    contractKind === "EMPLOYMENT" &&
    linkedEntityKind === "EMPLOYMENT_PROFILE"
  ) {
    return;
  }

  if (
    (contractKind === "TALENT_SERVICE" ||
      contractKind === "TALENT_MANAGEMENT") &&
    linkedEntityKind === "TALENT"
  ) {
    return;
  }

  throw new ContractRegistryInvalidLinkedEntityReferenceError(
    `contractKind ${contractKind} is incompatible with linkedEntityKind ${linkedEntityKind}`,
  );
}

function assertFileReferenceMetadataRule(
  fileReferenceId: string | null,
  fileDisplayName: string | null,
): void {
  if (fileReferenceId === null) {
    if (fileDisplayName === null) {
      return;
    }

    throw new ContractRegistryInvalidFileReferenceMetadataError(
      "fileDisplayName must be null when fileReferenceId is null",
    );
  }

  if (fileDisplayName === null) {
    throw new ContractRegistryInvalidFileReferenceMetadataError(
      "fileDisplayName is required when fileReferenceId is present",
    );
  }
}

function assertEffectiveWindowRule(
  effectiveStartDate: number,
  effectiveEndDate: number | null,
): void {
  if (
    effectiveEndDate !== null &&
    effectiveEndDate < effectiveStartDate
  ) {
    throw new ContractRegistryValidationError(
      "effectiveEndDate must not be earlier than effectiveStartDate",
    );
  }
}

function assertEvaluationDateWithinEffectiveWindow(
  effectiveStartDate: number,
  effectiveEndDate: number | null,
  evaluationDate: number,
): void {
  if (effectiveStartDate > evaluationDate) {
    throw new ContractRegistryStateError(
      "activateContractRecord requires evaluation date to be within effective window",
    );
  }

  if (
    effectiveEndDate !== null &&
    effectiveEndDate < evaluationDate
  ) {
    throw new ContractRegistryStateError(
      "activateContractRecord requires evaluation date to be within effective window",
    );
  }
}

function assertLifecycleDateMutationAllowed(params: {
  readonly mutationField: "expiryDate" | "terminationDate";
  readonly mutationDate: number;
  readonly effectiveStartDate: number;
  readonly currentEffectiveEndDate: number | null;
  readonly evaluationDate: number;
}): void {
  if (params.mutationDate < params.effectiveStartDate) {
    throw new ContractRegistryValidationError(
      `${params.mutationField} must not be earlier than effectiveStartDate`,
    );
  }

  if (
    params.currentEffectiveEndDate !== null &&
    params.mutationDate > params.currentEffectiveEndDate
  ) {
    throw new ContractRegistryValidationError(
      `${params.mutationField} must not be later than current effectiveEndDate`,
    );
  }

  if (params.mutationDate > params.evaluationDate) {
    throw new ContractRegistryValidationError(
      `${params.mutationField} must not be later than evaluation date`,
    );
  }
}

function normalizeRequiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new ContractRegistryValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new ContractRegistryValidationError(
      `${field} is required`,
    );
  }

  return normalized;
}

function normalizeDisplayText(
  value: unknown,
  field: string,
): string {
  return normalizeRequiredText(value, field)
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");
}

function normalizeOptionalNonNullableDisplayText(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    throw new ContractRegistryValidationError(
      `${field} must not be null`,
    );
  }

  return normalizeDisplayText(value, field);
}

function normalizeOptionalNullableText(
  value: unknown,
  field: string,
  options: {
    readonly missingAsNull: true;
  },
): string | null;
function normalizeOptionalNullableText(
  value: unknown,
  field: string,
  options: {
    readonly missingAsNull: false;
  },
): string | null | undefined;
function normalizeOptionalNullableText(
  value: unknown,
  field: string,
  options: {
    readonly missingAsNull: boolean;
  },
): string | null | undefined {
  if (value === undefined) {
    return options.missingAsNull
      ? null
      : undefined;
  }

  if (value === null) {
    return null;
  }

  return normalizeDisplayText(value, field);
}

function normalizeOptionalNullableDisplayText(
  value: unknown,
  field: string,
  options: {
    readonly missingAsNull: true;
  },
): string | null;
function normalizeOptionalNullableDisplayText(
  value: unknown,
  field: string,
  options: {
    readonly missingAsNull: false;
  },
): string | null | undefined;
function normalizeOptionalNullableDisplayText(
  value: unknown,
  field: string,
  options: {
    readonly missingAsNull: boolean;
  },
): string | null | undefined {
  if (options.missingAsNull) {
    return normalizeOptionalNullableText(
      value,
      field,
      {
        missingAsNull: true,
      },
    );
  }

  return normalizeOptionalNullableText(
    value,
    field,
    {
      missingAsNull: false,
    },
  );
}

function normalizeOptionalNullableId(
  value: unknown,
  field: string,
  options: {
    readonly missingAsNull: true;
  },
): string | null;
function normalizeOptionalNullableId(
  value: unknown,
  field: string,
  options: {
    readonly missingAsNull: false;
  },
): string | null | undefined;
function normalizeOptionalNullableId(
  value: unknown,
  field: string,
  options: {
    readonly missingAsNull: boolean;
  },
): string | null | undefined {
  if (value === undefined) {
    return options.missingAsNull
      ? null
      : undefined;
  }

  if (value === null) {
    return null;
  }

  return normalizeRequiredText(value, field);
}

function normalizeRequiredNullableId(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined) {
    throw new ContractRegistryValidationError(
      `${field} must be provided`,
    );
  }

  if (value === null) {
    return null;
  }

  return normalizeRequiredText(value, field);
}

function normalizeRequiredNullableDisplayText(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined) {
    throw new ContractRegistryValidationError(
      `${field} must be provided`,
    );
  }

  if (value === null) {
    return null;
  }

  return normalizeDisplayText(value, field);
}

function normalizeContractKind(
  value: unknown,
): ContractKind {
  if (typeof value !== "string") {
    throw new ContractRegistryValidationError(
      `contractKind must be one of ${CONTRACT_KINDS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    CONTRACT_KINDS.includes(
      normalized as ContractKind,
    )
  ) {
    return normalized as ContractKind;
  }

  throw new ContractRegistryValidationError(
    `contractKind must be one of ${CONTRACT_KINDS.join(", ")}`,
  );
}

function normalizeLinkedEntityKind(
  value: unknown,
): ContractLinkedEntityKind {
  if (typeof value !== "string") {
    throw new ContractRegistryValidationError(
      `linkedEntityKind must be one of ${CONTRACT_LINKED_ENTITY_KINDS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    CONTRACT_LINKED_ENTITY_KINDS.includes(
      normalized as ContractLinkedEntityKind,
    )
  ) {
    return normalized as ContractLinkedEntityKind;
  }

  throw new ContractRegistryValidationError(
    `linkedEntityKind must be one of ${CONTRACT_LINKED_ENTITY_KINDS.join(", ")}`,
  );
}

function normalizeOptionalLinkedEntityKind(
  value: unknown,
): ContractLinkedEntityKind | undefined {
  if (value === undefined) {
    return undefined;
  }

  return normalizeLinkedEntityKind(value);
}

function normalizeConfidentialityTier(
  value: unknown,
): ContractConfidentialityTier {
  if (typeof value !== "string") {
    throw new ContractRegistryValidationError(
      `confidentialityTier must be one of ${CONTRACT_CONFIDENTIALITY_TIERS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    CONTRACT_CONFIDENTIALITY_TIERS.includes(
      normalized as ContractConfidentialityTier,
    )
  ) {
    return normalized as ContractConfidentialityTier;
  }

  throw new ContractRegistryValidationError(
    `confidentialityTier must be one of ${CONTRACT_CONFIDENTIALITY_TIERS.join(", ")}`,
  );
}

function normalizeOptionalConfidentialityTier(
  value: unknown,
): ContractConfidentialityTier | undefined {
  if (value === undefined) {
    return undefined;
  }

  return normalizeConfidentialityTier(value);
}

function normalizeRequiredCanonicalCalendarDateValue(
  value: unknown,
  field: string,
): number {
  if (typeof value !== "string") {
    throw new ContractRegistryValidationError(
      `${field} must be a canonical calendar date`,
    );
  }

  return parseCanonicalCalendarDateValue(
    value,
    field,
  );
}

function normalizeOptionalCanonicalCalendarDateValue(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    throw new ContractRegistryValidationError(
      `${field} must not be null`,
    );
  }

  if (typeof value !== "string") {
    throw new ContractRegistryValidationError(
      `${field} must be a canonical calendar date`,
    );
  }

  return parseCanonicalCalendarDateValue(
    value,
    field,
  );
}

function normalizeOptionalNullableCanonicalCalendarDateValue(
  value: unknown,
  field: string,
  options: {
    readonly missingAsNull: true;
  },
): number | null;
function normalizeOptionalNullableCanonicalCalendarDateValue(
  value: unknown,
  field: string,
  options: {
    readonly missingAsNull: false;
  },
): number | null | undefined;
function normalizeOptionalNullableCanonicalCalendarDateValue(
  value: unknown,
  field: string,
  options: {
    readonly missingAsNull: boolean;
  },
): number | null | undefined {
  if (value === undefined) {
    return options.missingAsNull
      ? null
      : undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new ContractRegistryValidationError(
      `${field} must be a canonical calendar date`,
    );
  }

  return parseCanonicalCalendarDateValue(
    value,
    field,
  );
}

function parseCanonicalCalendarDateValue(
  value: string,
  field: string,
): number {
  const normalized = value.trim();

  if (!normalized) {
    throw new ContractRegistryValidationError(
      `${field} must be a canonical calendar date`,
    );
  }

  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/u.exec(
      normalized,
    );

  if (!match) {
    throw new ContractRegistryValidationError(
      `${field} must be a canonical calendar date`,
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMidnight = Date.UTC(
    year,
    month - 1,
    day,
  );
  const normalizedDate = new Date(utcMidnight);

  if (
    normalizedDate.getUTCFullYear() !== year ||
    normalizedDate.getUTCMonth() !== month - 1 ||
    normalizedDate.getUTCDate() !== day
  ) {
    throw new ContractRegistryValidationError(
      `${field} must be a canonical calendar date`,
    );
  }

  return utcMidnight;
}

function resolveRequiredGlobalScope(
  actor: Actor,
): "global" {
  if (
    PermissionGuard.hasContractRegistryScopeGrant(
      actor,
      "global",
    )
  ) {
    return "global";
  }

  throw new ContractRegistryPermissionScopeError(
    "Contract registry mutations require global scope",
  );
}

function currentEvaluationDate(): number {
  const now = new Date();

  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
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

function toContractRecordMutationView(
  record: ContractRecord,
): ContractRecordMutationView {
  return {
    id: record.id,
    contractCode: record.contractCode,
    title: record.title,
    contractKind: record.contractKind,
    linkedEntityKind: record.linkedEntityKind,
    linkedEmploymentProfileId:
      record.linkedEmploymentProfileId,
    linkedTalentId: record.linkedTalentId,
    ownerEmploymentProfileId:
      record.ownerEmploymentProfileId,
    confidentialityTier:
      record.confidentialityTier,
    status: record.status,
    effectiveStartDate:
      record.effectiveStartDate,
    effectiveEndDate:
      record.effectiveEndDate,
    fileReferenceId: record.fileReferenceId,
    fileDisplayName: record.fileDisplayName,
    description: record.description,
    externalRef: record.externalRef,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function assertAdminActorType(
  actor: Actor,
): void {
  if (actor.type === "admin") {
    return;
  }

  throw new SystemInvariantError(
    "PERMISSION_DENIED",
    `Contract registry access requires actor.type admin, received ${actor.type}`,
  );
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

function classifyContractRegistryMutationFailure(
  error: unknown,
): ContractRegistryMutationFailureClassification {
  if (
    error instanceof ContractRegistryValidationError
  ) {
    return "validation";
  }

  if (
    error instanceof ContractRegistryConflictError
  ) {
    return "conflict";
  }

  if (
    error instanceof ContractRegistryNotFoundError
  ) {
    return "not_found";
  }

  if (error instanceof ContractRegistryStateError) {
    return "state_error";
  }

  if (
    error instanceof
    ContractRegistryInvalidLinkedEntityReferenceError
  ) {
    return "invalid_linked_entity_reference";
  }

  if (
    error instanceof
    ContractRegistryInvalidOwnerReferenceError
  ) {
    return "invalid_owner_reference";
  }

  if (
    error instanceof
    ContractRegistryInvalidFileReferenceMetadataError
  ) {
    return "invalid_file_reference_metadata";
  }

  if (
    error instanceof
    ContractRegistryPermissionScopeError
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
