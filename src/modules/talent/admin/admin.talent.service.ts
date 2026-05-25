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
import {
  BusinessCodeSequenceRepository,
  formatBusinessCode,
} from "@core/business-code/business-code-sequence.repository";
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
  TalentConflictError,
  TalentInvalidEmploymentLinkageError,
  TalentInvalidManagerLinkageError,
  TalentNotFoundError,
  TalentStateError,
  TalentValidationError,
} from "@modules/talent/domain/talent.errors";
import { TALENT_CODE_POLICY } from "@modules/talent/domain/talent-code-policy";
import {
  TalentEmploymentProfileReadonlyAccess,
  TalentReferencedEmploymentProfile,
} from "@modules/talent/domain/talent-employment-profile-readonly-access";
import { deriveTalentDisplaySummary } from "@modules/talent/domain/talent-display";
import { TalentPlatformAccountReadonlyAccess } from "@modules/talent/domain/talent-platform-account-readonly-access";
import { TalentTalentGroupReadonlyAccess } from "@modules/talent/domain/talent-talent-group-readonly-access";
import { TalentWorkScheduleReadonlyAccess } from "@modules/talent/domain/talent-work-schedule-readonly-access";
import { TalentEventAssignmentReadonlyAccess } from "@modules/talent/domain/talent-event-assignment-readonly-access";
import {
  TalentRepository,
  UpdateTalentCoreInput,
} from "@modules/talent/domain/talent.repository";
import {
  TALENT_COMMERCIAL_PARTICIPATION_STATUSES,
  TALENT_OPERATIONAL_STATUSES,
  TALENT_ORIGINS,
  TalentCommercialParticipationStatus,
  TalentMutationView,
  TalentOperationalStatus,
  TalentOrigin,
  TalentRecord,
} from "@modules/talent/domain/talent.types";
import {
  ArchiveTalentCommand,
  AssignTalentManagerCommand,
  CreateTalentCommand,
  DeactivateTalentCommand,
  LinkTalentEmploymentProfileCommand,
  ReactivateTalentCommand,
  SuspendTalentCommand,
  TalentMutationResult,
  UpdateTalentCommercialParticipationStatusCommand,
  UpdateTalentCoreCommand,
} from "@modules/talent/shared/talent.contracts";

type TalentFailureClassification =
  | "validation"
  | "conflict"
  | "not_found"
  | "state_error"
  | "invalid_employment_linkage"
  | "invalid_manager_linkage"
  | "invariant"
  | "unknown";

export class TalentAdminService {
  constructor(
    private readonly repository: TalentRepository,
    private readonly codeSequenceRepository: BusinessCodeSequenceRepository,
    private readonly employmentProfileReadonlyAccess: TalentEmploymentProfileReadonlyAccess,
    private readonly talentGroupReadonlyAccess: TalentTalentGroupReadonlyAccess,
    private readonly platformAccountReadonlyAccess: TalentPlatformAccountReadonlyAccess,
    private readonly workScheduleReadonlyAccess: TalentWorkScheduleReadonlyAccess,
    private readonly eventAssignmentReadonlyAccess: TalentEventAssignmentReadonlyAccess,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly logger: StructuredLogger = createStructuredLogger(),
  ) {}

  async createTalent(
    actor: Actor,
    command: CreateTalentCommand,
  ): Promise<TalentMutationResult> {
    const operation = "talent.create";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_CREATE,
    );
    const input = normalizeCreateCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        talentCode: readOptionalLogString(
          command.talentCode,
        ),
        talentOrigin: readOptionalLogString(
          command.talentOrigin,
        ),
        managerEmploymentProfileId:
          readOptionalLogString(
            command.managerEmploymentProfileId,
          ) ?? undefined,
        linkedEmploymentProfileId:
          readOptionalLogString(
            command.linkedEmploymentProfileId,
          ) ?? undefined,
      },
      async (session) => {
        if (input.talentCode !== undefined) {
          const existing =
            await this.repository.findByTalentCode(
              input.talentCode,
              session,
            );

          if (existing) {
            throw new TalentConflictError(
              `Talent code already exists: ${input.talentCode}`,
            );
          }
        }

        const linkedEmploymentProfile =
          await this.assertLinkedEmploymentProfileAllowed(
          {
            talentOrigin: input.talentOrigin,
            linkedEmploymentProfileId:
              input.linkedEmploymentProfileId,
            managerEmploymentProfileId:
              input.managerEmploymentProfileId,
            currentTalentId: null,
            allowHistoricalResolution: false,
          },
          session,
        );
        await this.assertManagerLinkageAllowed(
          input.managerEmploymentProfileId,
          input.linkedEmploymentProfileId,
          session,
        );
        assertCommercialParticipationConsistency(
          input.commercialParticipationStatus,
          input.livestreamEligible,
          input.eventEligible,
        );

        let created!: TalentRecord;
        const maxAttempts =
          input.talentCode === undefined ? 5 : 1;

        for (
          let attempt = 1;
          attempt <= maxAttempts;
          attempt += 1
        ) {
          const talentCode =
            input.talentCode ??
            (await this.allocateGeneratedCode(session));
          const now = Date.now();
          const persistedNames =
            resolveCreatePersistenceNames(
              input,
              linkedEmploymentProfile,
            );
          const talent: TalentRecord = {
            id: crypto.randomUUID(),
            talentCode,
            stageName: persistedNames.stageName,
            normalizedStageName:
              persistedNames.normalizedStageName,
            legalName: persistedNames.legalName,
            normalizedLegalName:
              persistedNames.normalizedLegalName,
            displayShortName:
              input.displayShortName,
            normalizedDisplayShortName:
              input.normalizedDisplayShortName,
            talentOrigin: input.talentOrigin,
            operationalStatus: "ACTIVE",
            managerEmploymentProfileId:
              input.managerEmploymentProfileId,
            linkedEmploymentProfileId:
              input.linkedEmploymentProfileId,
            commercialParticipationStatus:
              input.commercialParticipationStatus,
            livestreamEligible:
              input.livestreamEligible,
            eventEligible:
              input.eventEligible,
            externalRef: input.externalRef,
            profileSummary:
              input.profileSummary,
            createdAt: now,
            updatedAt: now,
          };

          try {
            created = await this.repository.insert(
              talent,
              session,
            );
            break;
          } catch (error) {
            if (!isDuplicateKeyError(error)) {
              throw error;
            }

            if (input.talentCode !== undefined) {
              throw new TalentConflictError(
                "Talent code or linked employment profile already exists on a non-archived talent",
              );
            }

            if (attempt >= maxAttempts) {
              throw new TalentConflictError(
                "Generated talent code conflict detected on create",
              );
            }
          }
        }

        await this.recordAudit({
          actor,
          permission,
          talentId: created.id,
          mutationType: operation,
          metadata: {
            talentCode: created.talentCode,
            talentOrigin: created.talentOrigin,
            managerEmploymentProfileId:
              created.managerEmploymentProfileId,
            linkedEmploymentProfileId:
              created.linkedEmploymentProfileId,
          },
          session,
        });

        return this.toTalentMutationView(
          created,
          session,
        );
      },
      (result) => ({
        talentId: result.id,
        talentCode: result.talentCode,
        operationalStatus:
          result.operationalStatus,
      }),
    );
  }

  async updateTalentCore(
    actor: Actor,
    command: UpdateTalentCoreCommand,
  ): Promise<TalentMutationResult> {
    const operation = "talent.update-core";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_UPDATE,
    );
    const talentId = normalizeRequiredText(
      command.talentId,
      "talentId",
    );

    const hasStageName =
      command.stageName !== undefined;
    const hasLegalName =
      command.legalName !== undefined;
    const hasDisplayShortName =
      command.displayShortName !== undefined;
    const hasExternalRef =
      command.externalRef !== undefined;
    const hasProfileSummary =
      command.profileSummary !== undefined;

    if (
      !hasStageName &&
      !hasLegalName &&
      !hasDisplayShortName &&
      !hasExternalRef &&
      !hasProfileSummary
    ) {
      throw new TalentValidationError(
        "At least one field must be provided for update",
      );
    }

    const stageName = hasStageName
      ? normalizeOptionalDisplayText(
          command.stageName,
          "stageName",
        )
      : undefined;
    const legalName = hasLegalName
      ? normalizeDisplayText(
          command.legalName,
          "legalName",
        )
      : undefined;
    const displayShortName = hasDisplayShortName
      ? normalizeNullablePatchText(
          command.displayShortName,
          "displayShortName",
        )
      : undefined;
    const externalRef = hasExternalRef
      ? normalizeNullablePatchText(
          command.externalRef,
          "externalRef",
        )
      : undefined;
    const profileSummary = hasProfileSummary
      ? normalizeNullablePatchText(
          command.profileSummary,
          "profileSummary",
        )
      : undefined;

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        talentId: readOptionalLogString(
          command.talentId,
        ),
      },
      async (session) => {
        const current = await this.requireTalent(
          talentId,
          session,
        );

        if (
          current.operationalStatus === "ARCHIVED"
        ) {
          throw new TalentStateError(
            `Archived talent cannot be updated: ${talentId}`,
          );
        }

        await this.assertNonArchivedTalentLinkageInvariant(
          current,
          session,
        );

        if (
          stageName === null &&
          current.talentOrigin === "EXTERNAL"
        ) {
          throw new TalentValidationError(
            "stageName is required for external talent",
          );
        }

        const stageNameForPatch: string | undefined =
          stageName === undefined
            ? undefined
            : stageName === null &&
                current.talentOrigin === "INTERNAL"
              ? (
                await this.requireEmploymentProfileReference(
                  normalizeRequiredText(
                    current.linkedEmploymentProfileId,
                    "linkedEmploymentProfileId",
                  ),
                  "linked employment profile",
                  session,
                )
              ).displayName ??
              current.stageName
              : (stageName ?? undefined);

        const patch = buildTalentCorePatch({
          current,
          talentId,
          stageName: stageNameForPatch,
          legalName,
          displayShortName,
          externalRef,
          profileSummary,
        });
        const changedFields = Object.keys(
          patch,
        ).filter((field) => field !== "updatedAt");

        if (changedFields.length === 0) {
          throw new TalentValidationError(
            "At least one changed field is required",
          );
        }

        const updated =
          await this.repository.updateCore(
            patch,
            session,
          );

        if (!updated) {
          throw new TalentConflictError(
            `Failed to update talent: ${talentId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          talentId,
          mutationType: operation,
          metadata: {
            changedFields,
          },
          session,
        });

        return this.toTalentMutationView(
          updated,
          session,
        );
      },
      (result) => ({
        talentId: result.id,
        operationalStatus:
          result.operationalStatus,
      }),
    );
  }

  async assignTalentManager(
    actor: Actor,
    command: AssignTalentManagerCommand,
  ): Promise<TalentMutationResult> {
    const operation = "talent.assign-manager";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_MANAGE_MANAGER,
    );
    const talentId = normalizeRequiredText(
      command.talentId,
      "talentId",
    );
    const newManagerEmploymentProfileId =
      normalizeRequiredNullableId(
        command.newManagerEmploymentProfileId,
        "newManagerEmploymentProfileId",
      );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        talentId: readOptionalLogString(
          command.talentId,
        ),
        newManagerEmploymentProfileId:
          readOptionalLogString(
            command.newManagerEmploymentProfileId,
          ) ?? undefined,
      },
      async (session, controls) => {
        const current = await this.requireTalent(
          talentId,
          session,
        );

        if (
          current.operationalStatus === "ARCHIVED"
        ) {
          throw new TalentStateError(
            `Archived talent cannot change manager: ${talentId}`,
          );
        }

        await this.assertNonArchivedTalentLinkageInvariant(
          current,
          session,
        );
        await this.assertManagerLinkageAllowed(
          newManagerEmploymentProfileId,
          current.linkedEmploymentProfileId,
          session,
        );

        if (
          current.managerEmploymentProfileId ===
          newManagerEmploymentProfileId
        ) {
          controls.markExplicitNoOpSuccess();
          return this.toTalentMutationView(
            current,
            session,
          );
        }

        const updated =
          await this.repository.assignManager(
            {
              talentId,
              managerEmploymentProfileId:
                newManagerEmploymentProfileId,
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new TalentConflictError(
            `Failed to assign manager: ${talentId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          talentId,
          mutationType: operation,
          metadata: {
            previousManagerEmploymentProfileId:
              current.managerEmploymentProfileId,
            newManagerEmploymentProfileId,
          },
          session,
        });

        return this.toTalentMutationView(
          updated,
          session,
        );
      },
      (result) => ({
        talentId: result.id,
        managerEmploymentProfileId:
          result.managerEmploymentProfileId,
      }),
    );
  }

  async linkTalentEmploymentProfile(
    actor: Actor,
    command: LinkTalentEmploymentProfileCommand,
  ): Promise<TalentMutationResult> {
    const operation =
      "talent.link-employment-profile";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_MANAGE_EMPLOYMENT_LINK,
    );
    const talentId = normalizeRequiredText(
      command.talentId,
      "talentId",
    );
    const linkedEmploymentProfileId =
      normalizeRequiredText(
        command.linkedEmploymentProfileId,
        "linkedEmploymentProfileId",
      );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        talentId: readOptionalLogString(
          command.talentId,
        ),
        linkedEmploymentProfileId:
          readOptionalLogString(
            command.linkedEmploymentProfileId,
          ),
      },
      async (session, controls) => {
        const current = await this.requireTalent(
          talentId,
          session,
        );

        if (
          current.operationalStatus === "ARCHIVED"
        ) {
          throw new TalentStateError(
            `Archived talent cannot change employment link: ${talentId}`,
          );
        }

        if (current.talentOrigin !== "INTERNAL") {
          throw new TalentInvalidEmploymentLinkageError(
            `External talent cannot link an employment profile: ${talentId}`,
          );
        }

        await this.assertLinkedEmploymentProfileAllowed(
          {
            talentOrigin: current.talentOrigin,
            linkedEmploymentProfileId,
            managerEmploymentProfileId:
              current.managerEmploymentProfileId,
            currentTalentId: current.id,
            allowHistoricalResolution: false,
          },
          session,
        );
        await this.assertManagerLinkageAllowed(
          current.managerEmploymentProfileId,
          linkedEmploymentProfileId,
          session,
        );

        if (
          current.linkedEmploymentProfileId ===
          linkedEmploymentProfileId
        ) {
          controls.markExplicitNoOpSuccess();
          return this.toTalentMutationView(
            current,
            session,
          );
        }

        const updated =
          await this.repository.setLinkedEmploymentProfile(
            {
              talentId,
              linkedEmploymentProfileId,
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new TalentConflictError(
            `Failed to link employment profile: ${talentId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          talentId,
          mutationType: operation,
          metadata: {
            previousLinkedEmploymentProfileId:
              current.linkedEmploymentProfileId,
            newLinkedEmploymentProfileId:
              linkedEmploymentProfileId,
          },
          session,
        });

        return this.toTalentMutationView(
          updated,
          session,
        );
      },
      (result) => ({
        talentId: result.id,
        linkedEmploymentProfileId:
          result.linkedEmploymentProfileId,
      }),
    );
  }

  async suspendTalent(
    actor: Actor,
    command: SuspendTalentCommand,
  ): Promise<TalentMutationResult> {
    const operation = "talent.suspend";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_MANAGE_LIFECYCLE,
    );
    const talentId = normalizeRequiredText(
      command.talentId,
      "talentId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        talentId: readOptionalLogString(
          command.talentId,
        ),
      },
      async (session) => {
        const current = await this.requireTalent(
          talentId,
          session,
        );

        if (
          current.operationalStatus !== "ACTIVE"
        ) {
          throw new TalentStateError(
            `Talent ${talentId} cannot transition from ${current.operationalStatus} to SUSPENDED`,
          );
        }

        await this.assertNonArchivedTalentLinkageInvariant(
          current,
          session,
        );
        await this.assertManagerLinkageAllowed(
          current.managerEmploymentProfileId,
          current.linkedEmploymentProfileId,
          session,
        );
        await this.assertNoActiveTalentGroupMemberships(
          current.id,
          session,
        );
        await this.assertNoActiveOwnedPlatformAccounts(
          current.id,
          session,
        );
        await this.assertNoLiveScheduledWorkShifts(
          current.id,
          "suspend",
          Date.now(),
          session,
        );
        await this.assertNoLiveEventBindings(
          current.id,
          "suspend",
          Date.now(),
          session,
        );

        const updated =
          await this.repository.transitionOperationalStatus(
            {
              talentId,
              fromStatuses: ["ACTIVE"],
              toStatus: "SUSPENDED",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new TalentConflictError(
            `Talent state transition conflict for ${talentId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          talentId,
          mutationType: operation,
          metadata: {
            previousOperationalStatus:
              current.operationalStatus,
            nextOperationalStatus:
              updated.operationalStatus,
          },
          session,
        });

        return this.toTalentMutationView(
          updated,
          session,
        );
      },
      (result) => ({
        talentId: result.id,
        operationalStatus:
          result.operationalStatus,
      }),
    );
  }

  async reactivateTalent(
    actor: Actor,
    command: ReactivateTalentCommand,
  ): Promise<TalentMutationResult> {
    const operation = "talent.reactivate";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_MANAGE_LIFECYCLE,
    );
    const talentId = normalizeRequiredText(
      command.talentId,
      "talentId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        talentId: readOptionalLogString(
          command.talentId,
        ),
      },
      async (session) => {
        const current = await this.requireTalent(
          talentId,
          session,
        );

        if (
          current.operationalStatus !==
            "SUSPENDED" &&
          current.operationalStatus !== "INACTIVE"
        ) {
          throw new TalentStateError(
            `Talent ${talentId} cannot transition from ${current.operationalStatus} to ACTIVE`,
          );
        }

        await this.assertNonArchivedTalentLinkageInvariant(
          current,
          session,
        );
        await this.assertManagerLinkageAllowed(
          current.managerEmploymentProfileId,
          current.linkedEmploymentProfileId,
          session,
        );

        const updated =
          await this.repository.transitionOperationalStatus(
            {
              talentId,
              fromStatuses: [
                current.operationalStatus,
              ],
              toStatus: "ACTIVE",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new TalentConflictError(
            `Talent state transition conflict for ${talentId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          talentId,
          mutationType: operation,
          metadata: {
            previousOperationalStatus:
              current.operationalStatus,
            nextOperationalStatus:
              updated.operationalStatus,
          },
          session,
        });

        return this.toTalentMutationView(
          updated,
          session,
        );
      },
      (result) => ({
        talentId: result.id,
        operationalStatus:
          result.operationalStatus,
      }),
    );
  }

  async deactivateTalent(
    actor: Actor,
    command: DeactivateTalentCommand,
  ): Promise<TalentMutationResult> {
    const operation = "talent.deactivate";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_MANAGE_LIFECYCLE,
    );
    const talentId = normalizeRequiredText(
      command.talentId,
      "talentId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        talentId: readOptionalLogString(
          command.talentId,
        ),
      },
      async (session) => {
        const current = await this.requireTalent(
          talentId,
          session,
        );

        if (
          current.operationalStatus !== "ACTIVE" &&
          current.operationalStatus !== "SUSPENDED"
        ) {
          throw new TalentStateError(
            `Talent ${talentId} cannot transition from ${current.operationalStatus} to INACTIVE`,
          );
        }

        await this.assertNonArchivedTalentLinkageInvariant(
          current,
          session,
        );
        await this.assertManagerLinkageAllowed(
          current.managerEmploymentProfileId,
          current.linkedEmploymentProfileId,
          session,
        );
        await this.assertNoActiveTalentGroupMemberships(
          current.id,
          session,
        );
        await this.assertNoActiveOwnedPlatformAccounts(
          current.id,
          session,
        );
        await this.assertNoLiveScheduledWorkShifts(
          current.id,
          "deactivate",
          Date.now(),
          session,
        );
        await this.assertNoLiveEventBindings(
          current.id,
          "deactivate",
          Date.now(),
          session,
        );

        const updated =
          await this.repository.transitionOperationalStatus(
            {
              talentId,
              fromStatuses: [
                current.operationalStatus,
              ],
              toStatus: "INACTIVE",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new TalentConflictError(
            `Talent state transition conflict for ${talentId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          talentId,
          mutationType: operation,
          metadata: {
            previousOperationalStatus:
              current.operationalStatus,
            nextOperationalStatus:
              updated.operationalStatus,
          },
          session,
        });

        return this.toTalentMutationView(
          updated,
          session,
        );
      },
      (result) => ({
        talentId: result.id,
        operationalStatus:
          result.operationalStatus,
      }),
    );
  }

  async archiveTalent(
    actor: Actor,
    command: ArchiveTalentCommand,
  ): Promise<TalentMutationResult> {
    const operation = "talent.archive";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_MANAGE_LIFECYCLE,
    );
    const talentId = normalizeRequiredText(
      command.talentId,
      "talentId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        talentId: readOptionalLogString(
          command.talentId,
        ),
      },
      async (session) => {
        const current = await this.requireTalent(
          talentId,
          session,
        );

        if (
          current.operationalStatus !== "INACTIVE"
        ) {
          throw new TalentStateError(
            `Talent ${talentId} cannot transition from ${current.operationalStatus} to ARCHIVED`,
          );
        }

        await this.assertArchivedTalentLinkageResolvable(
          current,
          session,
        );
        await this.assertManagerLinkageAllowed(
          current.managerEmploymentProfileId,
          current.linkedEmploymentProfileId,
          session,
        );
        await this.assertNoNonRemovedTalentGroupMemberships(
          current.id,
          session,
        );
        await this.assertNoNonArchivedOwnedPlatformAccounts(
          current.id,
          session,
        );
        await this.assertNoLiveScheduledWorkShifts(
          current.id,
          "archive",
          Date.now(),
          session,
        );
        await this.assertNoLiveEventBindings(
          current.id,
          "archive",
          Date.now(),
          session,
        );

        const updated =
          await this.repository.transitionOperationalStatus(
            {
              talentId,
              fromStatuses: ["INACTIVE"],
              toStatus: "ARCHIVED",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new TalentConflictError(
            `Talent state transition conflict for ${talentId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          talentId,
          mutationType: operation,
          metadata: {
            previousOperationalStatus:
              current.operationalStatus,
            nextOperationalStatus:
              updated.operationalStatus,
          },
          session,
        });

        return this.toTalentMutationView(
          updated,
          session,
        );
      },
      (result) => ({
        talentId: result.id,
        operationalStatus:
          result.operationalStatus,
      }),
    );
  }

  async updateTalentCommercialParticipationStatus(
    actor: Actor,
    command: UpdateTalentCommercialParticipationStatusCommand,
  ): Promise<TalentMutationResult> {
    const operation =
      "talent.update-commercial-participation";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_MANAGE_COMMERCIAL_PARTICIPATION,
    );
    const talentId = normalizeRequiredText(
      command.talentId,
      "talentId",
    );
    const commercialParticipationStatus =
      normalizeCommercialParticipationStatus(
        command.newCommercialParticipationStatus,
      );
    const livestreamEligible = normalizeBoolean(
      command.livestreamEligible,
      "livestreamEligible",
    );
    const eventEligible = normalizeBoolean(
      command.eventEligible,
      "eventEligible",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        talentId: readOptionalLogString(
          command.talentId,
        ),
        commercialParticipationStatus:
          readOptionalLogString(
            command.newCommercialParticipationStatus,
          ),
      },
      async (session, controls) => {
        const current = await this.requireTalent(
          talentId,
          session,
        );

        if (
          current.operationalStatus === "ARCHIVED"
        ) {
          throw new TalentStateError(
            `Archived talent cannot update commercial participation: ${talentId}`,
          );
        }

        assertCommercialParticipationConsistency(
          commercialParticipationStatus,
          livestreamEligible,
          eventEligible,
        );

        if (
          current.commercialParticipationStatus ===
            commercialParticipationStatus &&
          current.livestreamEligible ===
            livestreamEligible &&
          current.eventEligible === eventEligible
        ) {
          controls.markExplicitNoOpSuccess();
          return this.toTalentMutationView(
            current,
            session,
          );
        }

        const updated =
          await this.repository.updateCommercialParticipation(
            {
              talentId,
              commercialParticipationStatus,
              livestreamEligible,
              eventEligible,
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new TalentConflictError(
            `Failed to update commercial participation: ${talentId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          talentId,
          mutationType: operation,
          metadata: {
            previousCommercialParticipationStatus:
              current.commercialParticipationStatus,
            newCommercialParticipationStatus:
              commercialParticipationStatus,
            previousLivestreamEligible:
              current.livestreamEligible,
            newLivestreamEligible:
              livestreamEligible,
            previousEventEligible:
              current.eventEligible,
            newEventEligible:
              eventEligible,
          },
          session,
        });

        return this.toTalentMutationView(
          updated,
          session,
        );
      },
      (result) => ({
        talentId: result.id,
        commercialParticipationStatus:
          result.commercialParticipationStatus,
      }),
    );
  }

  private assertPermission(
    actor: Actor,
    permissionCode: Permission,
  ): PermissionContract {
    const permission =
      PermissionResolver.resolve(permissionCode);

    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);
    return permission;
  }

  private async requireTalent(
    talentId: string,
    session: ClientSession,
  ): Promise<TalentRecord> {
    const talent = await this.repository.findById(
      talentId,
      session,
    );

    if (!talent) {
      throw new TalentNotFoundError(talentId);
    }

    return talent;
  }

  private async allocateGeneratedCode(
    session: ClientSession,
  ): Promise<string> {
    const maxExisting =
      await this.repository.findMaxGeneratedCodeSequence(
        TALENT_CODE_POLICY,
        session,
      );
    await this.codeSequenceRepository.ensureAtLeast(
      TALENT_CODE_POLICY.moduleKey,
      TALENT_CODE_POLICY.bucket,
      maxExisting,
      session,
    );
    const next =
      await this.codeSequenceRepository.allocateNext(
        TALENT_CODE_POLICY.moduleKey,
        TALENT_CODE_POLICY.bucket,
        session,
      );

    return formatBusinessCode(
      TALENT_CODE_POLICY,
      next,
    );
  }

  private async assertManagerLinkageAllowed(
    managerEmploymentProfileId: string | null,
    linkedEmploymentProfileId: string | null,
    session: ClientSession,
  ): Promise<void> {
    if (managerEmploymentProfileId === null) {
      return;
    }

    if (
      linkedEmploymentProfileId !== null &&
      managerEmploymentProfileId ===
        linkedEmploymentProfileId
    ) {
      throw new TalentInvalidManagerLinkageError(
        "managerEmploymentProfileId must not equal linkedEmploymentProfileId",
      );
    }

    const manager =
      await this.requireEmploymentProfileReference(
        managerEmploymentProfileId,
        "manager",
        session,
      );

    if (
      manager.employmentStatus !== "ACTIVE" &&
      manager.employmentStatus !== "ON_LEAVE"
    ) {
      throw new TalentInvalidManagerLinkageError(
        `Talent manager employment profile must be ACTIVE or ON_LEAVE: ${managerEmploymentProfileId}`,
      );
    }
  }

  private async assertLinkedEmploymentProfileAllowed(
    params: {
      readonly talentOrigin: TalentOrigin;
      readonly linkedEmploymentProfileId: string | null;
      readonly managerEmploymentProfileId: string | null;
      readonly currentTalentId: string | null;
      readonly allowHistoricalResolution: boolean;
    },
    session: ClientSession,
  ): Promise<TalentReferencedEmploymentProfile | null> {
    if (params.talentOrigin === "EXTERNAL") {
      if (params.linkedEmploymentProfileId !== null) {
        throw new TalentInvalidEmploymentLinkageError(
          "External talent must not have linkedEmploymentProfileId",
        );
      }

      return null;
    }

    if (params.linkedEmploymentProfileId === null) {
      throw new TalentInvalidEmploymentLinkageError(
        "Internal talent requires linkedEmploymentProfileId",
      );
    }

    if (
      params.managerEmploymentProfileId !== null &&
      params.managerEmploymentProfileId ===
        params.linkedEmploymentProfileId
    ) {
      throw new TalentInvalidManagerLinkageError(
        "managerEmploymentProfileId must not equal linkedEmploymentProfileId",
      );
    }

    const linkedEmploymentProfile =
      await this.requireEmploymentProfileReference(
        params.linkedEmploymentProfileId,
        "linked employment profile",
        session,
      );

    if (
      !params.allowHistoricalResolution &&
      (linkedEmploymentProfile.employmentStatus ===
        "TERMINATED" ||
        linkedEmploymentProfile.employmentStatus ===
          "ARCHIVED")
    ) {
      throw new TalentInvalidEmploymentLinkageError(
        `Linked employment profile must not be TERMINATED or ARCHIVED: ${params.linkedEmploymentProfileId}`,
      );
    }

    const existingLinkedTalent =
      await this.repository.findNonArchivedByLinkedEmploymentProfileId(
        params.linkedEmploymentProfileId,
        session,
      );

    if (
      existingLinkedTalent &&
      existingLinkedTalent.id !==
        params.currentTalentId
    ) {
      throw new TalentConflictError(
        `Linked employment profile already belongs to another non-archived talent: ${params.linkedEmploymentProfileId}`,
      );
    }

    return linkedEmploymentProfile;
  }

  private async assertNonArchivedTalentLinkageInvariant(
    talent: TalentRecord,
    session: ClientSession,
  ): Promise<void> {
    if (talent.talentOrigin === "EXTERNAL") {
      if (talent.linkedEmploymentProfileId !== null) {
        throw new TalentInvalidEmploymentLinkageError(
          "External talent must not have linkedEmploymentProfileId",
        );
      }

      return;
    }

    await this.assertLinkedEmploymentProfileAllowed(
      {
        talentOrigin: talent.talentOrigin,
        linkedEmploymentProfileId:
          talent.linkedEmploymentProfileId,
        managerEmploymentProfileId:
          talent.managerEmploymentProfileId,
        currentTalentId: talent.id,
        allowHistoricalResolution: false,
      },
      session,
    );
  }

  private async assertArchivedTalentLinkageResolvable(
    talent: TalentRecord,
    session: ClientSession,
  ): Promise<void> {
    if (talent.talentOrigin === "EXTERNAL") {
      if (talent.linkedEmploymentProfileId !== null) {
        throw new TalentInvalidEmploymentLinkageError(
          "External talent must not have linkedEmploymentProfileId",
        );
      }

      return;
    }

    await this.assertLinkedEmploymentProfileAllowed(
      {
        talentOrigin: talent.talentOrigin,
        linkedEmploymentProfileId:
          talent.linkedEmploymentProfileId,
        managerEmploymentProfileId:
          talent.managerEmploymentProfileId,
        currentTalentId: talent.id,
        allowHistoricalResolution: true,
      },
      session,
    );
  }

  private async toTalentMutationView(
    talent: TalentRecord,
    session: ClientSession,
  ): Promise<TalentMutationView> {
    const linkedEmploymentProfile =
      talent.talentOrigin === "INTERNAL" &&
      talent.linkedEmploymentProfileId
        ? await this.employmentProfileReadonlyAccess.findById(
            talent.linkedEmploymentProfileId,
            session,
          )
        : null;

    return toTalentMutationView(
      talent,
      linkedEmploymentProfile,
    );
  }

  private async assertNoActiveTalentGroupMemberships(
    talentId: string,
    session: ClientSession,
  ): Promise<void> {
    const hasActiveMemberships =
      await this.talentGroupReadonlyAccess.hasActiveMembershipsForTalent(
        talentId,
        session,
      );

    if (hasActiveMemberships) {
      throw new TalentStateError(
        `Talent ${talentId} cannot transition while ACTIVE talent group memberships exist`,
      );
    }
  }

  private async assertNoNonRemovedTalentGroupMemberships(
    talentId: string,
    session: ClientSession,
  ): Promise<void> {
    const hasNonRemovedMemberships =
      await this.talentGroupReadonlyAccess.hasNonRemovedMembershipsForTalent(
        talentId,
        session,
      );

    if (hasNonRemovedMemberships) {
      throw new TalentStateError(
        `Talent ${talentId} cannot transition while non-removed talent group memberships exist`,
      );
    }
  }

  private async assertNoActiveOwnedPlatformAccounts(
    talentId: string,
    session: ClientSession,
  ): Promise<void> {
    const hasActiveOwnedPlatformAccounts =
      await this.platformAccountReadonlyAccess.hasActiveOwnedPlatformAccountsForTalent(
        talentId,
        session,
      );

    if (hasActiveOwnedPlatformAccounts) {
      throw new TalentStateError(
        `Talent ${talentId} cannot transition while ACTIVE platform accounts remain owned`,
      );
    }
  }

  private async assertNoNonArchivedOwnedPlatformAccounts(
    talentId: string,
    session: ClientSession,
  ): Promise<void> {
    const hasNonArchivedOwnedPlatformAccounts =
      await this.platformAccountReadonlyAccess.hasNonArchivedOwnedPlatformAccountsForTalent(
        talentId,
        session,
      );

    if (hasNonArchivedOwnedPlatformAccounts) {
      throw new TalentStateError(
        `Talent ${talentId} cannot transition while non-archived platform accounts remain owned`,
      );
    }
  }

  private async assertNoLiveScheduledWorkShifts(
    talentId: string,
    operation:
      | "suspend"
      | "deactivate"
      | "archive",
    evaluationTime: number,
    session: ClientSession,
  ): Promise<void> {
    const hasLiveScheduledWorkShift =
      await this.workScheduleReadonlyAccess.hasLiveScheduledShiftForTalent(
        talentId,
        evaluationTime,
        session,
      );

    if (!hasLiveScheduledWorkShift) {
      return;
    }

    throw new TalentStateError(
      `Talent ${talentId} cannot ${operation} while live scheduled work shifts exist`,
    );
  }

  private async assertNoLiveEventBindings(
    talentId: string,
    operation:
      | "suspend"
      | "deactivate"
      | "archive",
    evaluationTime: number,
    session: ClientSession,
  ): Promise<void> {
    const hasLiveEventBinding =
      await this.eventAssignmentReadonlyAccess.hasLiveEventBindingForTalent(
        talentId,
        evaluationTime,
        session,
      );

    if (!hasLiveEventBinding) {
      return;
    }

    throw new TalentStateError(
      `Talent ${talentId} cannot ${operation} while live event bindings exist`,
    );
  }

  private async requireEmploymentProfileReference(
    employmentProfileId: string,
    label: string,
    session: ClientSession,
  ): Promise<TalentReferencedEmploymentProfile> {
    const employmentProfile =
      await this.employmentProfileReadonlyAccess.findById(
        employmentProfileId,
        session,
      );

    if (!employmentProfile) {
      const humanLabel =
        label === "manager"
          ? "Talent manager employment profile"
          : "Linked employment profile";
      const errorType =
        label === "manager"
          ? TalentInvalidManagerLinkageError
          : TalentInvalidEmploymentLinkageError;

      throw new errorType(
        `${humanLabel} does not exist: ${employmentProfileId}`,
      );
    }

    return employmentProfile;
  }

  private async recordAudit(params: {
    readonly actor: Actor;
    readonly permission: PermissionContract;
    readonly talentId: string;
    readonly mutationType: AuthoritativeAdminMutationIdentity;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly session: ClientSession;
  }): Promise<void> {
    await this.audit.record(
      params.actor,
      params.permission,
      params.talentId,
      {
        mutationType: params.mutationType,
        targetId: params.talentId,
        targetType: "talent",
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
            classifyTalentMutationFailure(error),
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

interface NormalizedCreateCommand {
  readonly talentCode: string | undefined;
  readonly stageName: string | null;
  readonly legalName: string | null;
  readonly displayShortName: string | null;
  readonly normalizedDisplayShortName: string | null;
  readonly talentOrigin: TalentOrigin;
  readonly managerEmploymentProfileId: string | null;
  readonly linkedEmploymentProfileId: string | null;
  readonly commercialParticipationStatus: TalentCommercialParticipationStatus;
  readonly livestreamEligible: boolean;
  readonly eventEligible: boolean;
  readonly externalRef: string | null;
  readonly profileSummary: string | null;
}

function normalizeCreateCommand(
  command: CreateTalentCommand,
): NormalizedCreateCommand {
  const talentOrigin = normalizeTalentOrigin(
    command.talentOrigin,
  );
  const stageName =
    talentOrigin === "EXTERNAL"
      ? normalizeDisplayText(
          command.stageName,
          "stageName",
        )
      : normalizeOptionalDisplayText(
          command.stageName,
          "stageName",
        );
  const legalName =
    talentOrigin === "EXTERNAL"
      ? normalizeDisplayText(
          command.legalName,
          "legalName",
        )
      : normalizeOptionalDisplayText(
          command.legalName,
          "legalName",
        );
  const displayShortName = normalizeNullableText(
    command.displayShortName,
    "displayShortName",
  );

  return {
    talentCode: normalizeOptionalCreateCode(
      command.talentCode,
      "talentCode",
    ),
    stageName,
    legalName,
    displayShortName,
    normalizedDisplayShortName:
      displayShortName === null
        ? null
        : normalizeNameForSearch(
            displayShortName,
          ),
    talentOrigin,
    managerEmploymentProfileId:
      normalizeOptionalNullableId(
        command.managerEmploymentProfileId,
        "managerEmploymentProfileId",
      ),
    linkedEmploymentProfileId:
      normalizeOptionalNullableId(
        command.linkedEmploymentProfileId,
        "linkedEmploymentProfileId",
      ),
    commercialParticipationStatus:
      normalizeCommercialParticipationStatus(
        command.commercialParticipationStatus,
      ),
    livestreamEligible: normalizeBoolean(
      command.livestreamEligible,
      "livestreamEligible",
    ),
    eventEligible: normalizeBoolean(
      command.eventEligible,
      "eventEligible",
    ),
    externalRef: normalizeNullableText(
      command.externalRef,
      "externalRef",
    ),
    profileSummary: normalizeNullableText(
      command.profileSummary,
      "profileSummary",
    ),
  };
}

function resolveCreatePersistenceNames(
  input: NormalizedCreateCommand,
  linkedEmploymentProfile: TalentReferencedEmploymentProfile | null,
): {
  readonly stageName: string;
  readonly normalizedStageName: string;
  readonly legalName: string;
  readonly normalizedLegalName: string;
} {
  if (input.talentOrigin === "EXTERNAL") {
    const stageName = input.stageName ?? "";
    const legalName = input.legalName ?? "";
    return {
      stageName,
      normalizedStageName:
        normalizeNameForSearch(stageName),
      legalName,
      normalizedLegalName:
        normalizeNameForSearch(legalName),
    };
  }

  const employmentProfileDisplayName =
    linkedEmploymentProfile?.displayName ??
    linkedEmploymentProfile?.legalName ??
    linkedEmploymentProfile?.employeeCode ??
    "Internal Talent";
  const employmentProfileLegalName =
    linkedEmploymentProfile?.legalName ??
    linkedEmploymentProfile?.displayName ??
    employmentProfileDisplayName;
  const stageName =
    input.stageName ?? employmentProfileDisplayName;
  const legalName =
    input.legalName ?? employmentProfileLegalName;

  return {
    stageName,
    normalizedStageName:
      normalizeNameForSearch(stageName),
    legalName,
    normalizedLegalName:
      normalizeNameForSearch(legalName),
  };
}

function normalizeOptionalCreateCode(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();
  return normalized.length > 0
    ? normalized
    : undefined;
}

function buildTalentCorePatch(params: {
  readonly current: TalentRecord;
  readonly talentId: string;
  readonly stageName?: string;
  readonly legalName?: string;
  readonly displayShortName?: string | null;
  readonly externalRef?: string | null;
  readonly profileSummary?: string | null;
}): UpdateTalentCoreInput {
  const patch: {
    talentId: string;
    updatedAt: number;
    stageName?: string;
    normalizedStageName?: string;
    legalName?: string;
    normalizedLegalName?: string;
    displayShortName?: string | null;
    normalizedDisplayShortName?: string | null;
    externalRef?: string | null;
    profileSummary?: string | null;
  } = {
    talentId: params.talentId,
    updatedAt: Date.now(),
  };

  if (
    params.stageName !== undefined &&
    params.stageName !== params.current.stageName
  ) {
    patch.stageName = params.stageName;
    patch.normalizedStageName =
      normalizeNameForSearch(params.stageName);
  }

  if (
    params.legalName !== undefined &&
    params.legalName !== params.current.legalName
  ) {
    patch.legalName = params.legalName;
    patch.normalizedLegalName =
      normalizeNameForSearch(params.legalName);
  }

  if (
    params.displayShortName !== undefined &&
    params.displayShortName !==
      params.current.displayShortName
  ) {
    patch.displayShortName =
      params.displayShortName;
    patch.normalizedDisplayShortName =
      params.displayShortName === null
        ? null
        : normalizeNameForSearch(
            params.displayShortName,
          );
  }

  if (
    params.externalRef !== undefined &&
    params.externalRef !==
      params.current.externalRef
  ) {
    patch.externalRef = params.externalRef;
  }

  if (
    params.profileSummary !== undefined &&
    params.profileSummary !==
      params.current.profileSummary
  ) {
    patch.profileSummary =
      params.profileSummary;
  }

  return patch;
}

function assertCommercialParticipationConsistency(
  commercialParticipationStatus: TalentCommercialParticipationStatus,
  livestreamEligible: boolean,
  eventEligible: boolean,
): void {
  if (
    commercialParticipationStatus === "BLOCKED" &&
    (livestreamEligible || eventEligible)
  ) {
    throw new TalentValidationError(
      "BLOCKED commercialParticipationStatus requires livestreamEligible=false and eventEligible=false",
    );
  }
}

function toTalentMutationView(
  talent: TalentRecord,
  linkedEmploymentProfile?: TalentReferencedEmploymentProfile | null,
): TalentMutationView {
  const display = deriveTalentDisplaySummary(
    talent,
    linkedEmploymentProfile,
  );

  return {
    id: talent.id,
    talentCode: talent.talentCode,
    displayName: display.displayName,
    performanceAlias: display.performanceAlias,
    stageName: talent.stageName,
    legalName: talent.legalName,
    displayShortName: talent.displayShortName,
    talentOrigin: talent.talentOrigin,
    operationalStatus:
      talent.operationalStatus,
    managerEmploymentProfileId:
      talent.managerEmploymentProfileId,
    linkedEmploymentProfileId:
      talent.linkedEmploymentProfileId,
    commercialParticipationStatus:
      talent.commercialParticipationStatus,
    livestreamEligible:
      talent.livestreamEligible,
    eventEligible: talent.eventEligible,
    externalRef: talent.externalRef,
    profileSummary: talent.profileSummary,
    createdAt: talent.createdAt,
    updatedAt: talent.updatedAt,
  };
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

function normalizeRequiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new TalentValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new TalentValidationError(
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
    .replace(/\s+/gu, " ");
}

function normalizeOptionalDisplayText(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TalentValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");

  return normalized.length > 0 ? normalized : null;
}

function normalizeNullableText(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TalentValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");

  if (normalized.length === 0) {
    throw new TalentValidationError(
      `${field} must not be empty`,
    );
  }

  return normalized;
}

function normalizeNullablePatchText(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined) {
    throw new TalentValidationError(
      `${field} must be provided`,
    );
  }

  return normalizeNullableText(value, field);
}

function normalizeOptionalNullableId(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TalentValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new TalentValidationError(
      `${field} must not be empty`,
    );
  }

  return normalized;
}

function normalizeRequiredNullableId(
  value: unknown,
  field: string,
): string | null {
  if (value === null) {
    return null;
  }

  if (value === undefined) {
    throw new TalentValidationError(
      `${field} must be provided`,
    );
  }

  if (typeof value !== "string") {
    throw new TalentValidationError(
      `${field} must be a string or null`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new TalentValidationError(
      `${field} must not be empty`,
    );
  }

  return normalized;
}

function normalizeTalentOrigin(
  value: unknown,
): TalentOrigin {
  if (typeof value !== "string") {
    throw new TalentValidationError(
      `talentOrigin must be one of ${TALENT_ORIGINS.join(", ")}`,
    );
  }

  const normalized = value.trim();

  if (
    TALENT_ORIGINS.includes(
      normalized as TalentOrigin,
    )
  ) {
    return normalized as TalentOrigin;
  }

  throw new TalentValidationError(
    `talentOrigin must be one of ${TALENT_ORIGINS.join(", ")}`,
  );
}

function normalizeCommercialParticipationStatus(
  value: unknown,
): TalentCommercialParticipationStatus {
  if (typeof value !== "string") {
    throw new TalentValidationError(
      `commercialParticipationStatus must be one of ${TALENT_COMMERCIAL_PARTICIPATION_STATUSES.join(", ")}`,
    );
  }

  const normalized = value.trim();

  if (
    TALENT_COMMERCIAL_PARTICIPATION_STATUSES.includes(
      normalized as TalentCommercialParticipationStatus,
    )
  ) {
    return normalized as TalentCommercialParticipationStatus;
  }

  throw new TalentValidationError(
    `commercialParticipationStatus must be one of ${TALENT_COMMERCIAL_PARTICIPATION_STATUSES.join(", ")}`,
  );
}

function normalizeBoolean(
  value: unknown,
  field: string,
): boolean {
  if (typeof value !== "boolean") {
    throw new TalentValidationError(
      `${field} must be a boolean`,
    );
  }

  return value;
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

function isDuplicateKeyError(
  error: unknown,
): error is MongoServerError {
  return (
    error instanceof MongoServerError &&
    error.code === 11000
  );
}

function classifyTalentMutationFailure(
  error: unknown,
): TalentFailureClassification {
  if (error instanceof TalentValidationError) {
    return "validation";
  }

  if (error instanceof TalentConflictError) {
    return "conflict";
  }

  if (error instanceof TalentNotFoundError) {
    return "not_found";
  }

  if (error instanceof TalentStateError) {
    return "state_error";
  }

  if (
    error instanceof
    TalentInvalidEmploymentLinkageError
  ) {
    return "invalid_employment_linkage";
  }

  if (
    error instanceof TalentInvalidManagerLinkageError
  ) {
    return "invalid_manager_linkage";
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

function readOptionalLogString(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0
    ? normalized
    : undefined;
}
