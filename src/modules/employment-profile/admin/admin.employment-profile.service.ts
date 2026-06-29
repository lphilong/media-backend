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
  EmploymentProfileInvalidOrgAssignmentError,
  EmploymentProfileConflictError,
  EmploymentProfileInvalidUserLinkageError,
  EmploymentProfileManagerCycleError,
  EmploymentProfileNotFoundError,
  EmploymentProfilePermissionScopeError,
  EmploymentProfileStateError,
  EmploymentProfileValidationError,
} from "@modules/employment-profile/domain/employment-profile.errors";
import { EMPLOYMENT_PROFILE_CODE_POLICY } from "@modules/employment-profile/domain/employment-profile-code-policy";
import { EmploymentProfileWorkScheduleReadonlyAccess } from "@modules/employment-profile/domain/employment-profile-work-schedule-readonly-access";
import { EmploymentProfileEventAssignmentReadonlyAccess } from "@modules/employment-profile/domain/employment-profile-event-assignment-readonly-access";
import { EmploymentProfileOrgUnitReadonlyAccess } from "@modules/employment-profile/domain/employment-profile-org-unit-readonly-access";
import { EmploymentProfileTalentReadonlyAccess } from "@modules/employment-profile/domain/employment-profile-talent-readonly-access";
import {
  EmploymentProfileRepository,
  UpdateEmploymentProfileCoreInput,
} from "@modules/employment-profile/domain/employment-profile.repository";
import { EmploymentProfileUserReadonlyAccess } from "@modules/employment-profile/domain/employment-profile-user-readonly-access";
import {
  EMPLOYMENT_CONTRACT_STATUSES,
  EMPLOYMENT_KINDS,
  EMPLOYMENT_STATUSES,
  EmploymentContractStatus,
  EmploymentKind,
  EmploymentProfileMutationView,
  EmploymentProfileRecord,
  EmploymentStatus,
} from "@modules/employment-profile/domain/employment-profile.types";
import {
  ArchiveEmploymentProfileCommand,
  AssignEmploymentProfileManagerCommand,
  AssignEmploymentProfileOrgUnitCommand,
  CreateEmploymentProfileCommand,
  EmploymentProfileMutationResult,
  LinkEmploymentProfileUserCommand,
  PlaceEmploymentProfileOnLeaveCommand,
  ReactivateEmploymentProfileCommand,
  ReturnEmploymentProfileFromLeaveCommand,
  SuspendEmploymentProfileCommand,
  TerminateEmploymentProfileCommand,
  UnlinkEmploymentProfileUserCommand,
  UpdateEmploymentProfileContractStatusCommand,
  UpdateEmploymentProfileCoreCommand,
} from "@modules/employment-profile/shared/employment-profile.contracts";
import { requireAdminObjectScopeAuthority } from "@modules/role/domain/admin-object-scope-authority";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";
import { ResponsibilityAdminService } from "@modules/responsibility/admin/admin.responsibility.service";

type EmploymentProfileFailureClassification =
  | "validation"
  | "conflict"
  | "not_found"
  | "state_error"
  | "manager_cycle"
  | "invalid_user_linkage"
  | "invalid_org_assignment"
  | "invariant"
  | "unknown";

export class EmploymentProfileAdminService {
  private responsibilityService: ResponsibilityAdminService | null = null;

  constructor(
    private readonly repository: EmploymentProfileRepository,
    private readonly codeSequenceRepository: BusinessCodeSequenceRepository,
    private readonly orgUnitReadonlyAccess: EmploymentProfileOrgUnitReadonlyAccess,
    private readonly userReadonlyAccess: EmploymentProfileUserReadonlyAccess,
    private readonly talentReadonlyAccess: EmploymentProfileTalentReadonlyAccess,
    private readonly workScheduleReadonlyAccess: EmploymentProfileWorkScheduleReadonlyAccess,
    private readonly eventAssignmentReadonlyAccess: EmploymentProfileEventAssignmentReadonlyAccess,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly structuredAuthority: StructuredScopeAuthorityService = createMissingStructuredAuthority(),
    private readonly logger: StructuredLogger = createStructuredLogger(),
  ) {}

  attachResponsibilityService(service: ResponsibilityAdminService): void {
    this.responsibilityService = service;
  }

  async createEmploymentProfile(
    actor: Actor,
    command: CreateEmploymentProfileCommand,
  ): Promise<EmploymentProfileMutationResult> {
    const operation = "employment-profile.create";
    const permission = this.assertPermission(
      actor,
      Permission.EMPLOYMENT_PROFILE_CREATE,
    );
    const input = normalizeCreateCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        employeeCode: readOptionalLogString(
          command.employeeCode,
        ),
        orgUnitId: readOptionalLogString(
          command.orgUnitId,
        ),
        linkedUserId: readOptionalLogString(
          command.linkedUserId,
        ),
      },
      async (session) => {
        const employmentProfileId =
          crypto.randomUUID();
        if (input.employeeCode !== undefined) {
          const existing =
            await this.repository.findByEmployeeCode(
              input.employeeCode,
              session,
            );

          if (existing) {
            throw new EmploymentProfileConflictError(
              `Employee code already exists: ${input.employeeCode}`,
            );
          }
        }

        await this.assertOrgUnitActive(
          input.orgUnitId,
          session,
        );
        await this.requireManagedOrgUnitAuthority(
          actor,
          Permission.EMPLOYMENT_PROFILE_CREATE,
          input.orgUnitId,
        );

        if (input.linkedUserId) {
          await this.assertLinkedUserEligible(
            input.linkedUserId,
            null,
            session,
          );
        }

        await this.assertEmploymentProfileAttributionEligible(
          input.recruiterEmploymentProfileId,
          "recruiterEmploymentProfileId",
          session,
        );
        await this.assertEmploymentProfileAttributionEligible(
          input.hrOwnerEmploymentProfileId,
          "hrOwnerEmploymentProfileId",
          session,
        );
        await this.assertEmploymentProfileAttributionEligible(
          input.onboardingOwnerEmploymentProfileId,
          "onboardingOwnerEmploymentProfileId",
          session,
        );
        await this.assertEmploymentProfileAttributionEligible(
          input.sourcedByEmploymentProfileId,
          "sourcedByEmploymentProfileId",
          session,
        );

        const now = Date.now();
        assertCalendarDateNotLaterThanEvaluationTime(
          input.employmentStartDate,
          "employmentStartDate",
          now,
        );
        let created!: EmploymentProfileRecord;
        const maxAttempts =
          input.employeeCode === undefined ? 5 : 1;

        for (
          let attempt = 1;
          attempt <= maxAttempts;
          attempt += 1
        ) {
          const employeeCode =
            input.employeeCode ??
            (await this.allocateGeneratedCode(session));
          const employmentProfile: EmploymentProfileRecord =
            {
              id: employmentProfileId,
              employeeCode,
              legalName: input.legalName,
              normalizedLegalName:
                input.normalizedLegalName,
              displayName: input.displayName,
              normalizedDisplayName:
                input.normalizedDisplayName,
              employmentKind: input.employmentKind,
              jobTitle: input.jobTitle,
              titleDescription:
                input.titleDescription,
              externalRef: input.externalRef,
              orgUnitId: input.orgUnitId,
              managerEmploymentProfileId: null,
              recruiterEmploymentProfileId:
                input.recruiterEmploymentProfileId,
              hrOwnerEmploymentProfileId:
                input.hrOwnerEmploymentProfileId,
              onboardingOwnerEmploymentProfileId:
                input.onboardingOwnerEmploymentProfileId,
              sourcedByEmploymentProfileId:
                input.sourcedByEmploymentProfileId,
              linkedUserId: input.linkedUserId,
              employmentStatus: "ACTIVE",
              contractStatus: input.contractStatus,
              employmentStartDate:
                input.employmentStartDate,
              employmentEndDate: null,
              hiredAt: input.hiredAt,
              onboardedAt: input.onboardedAt,
              createdAt: now,
              updatedAt: now,
            };

          try {
            created = await this.repository.insert(
              employmentProfile,
              session,
            );
            break;
          } catch (error) {
            if (!isDuplicateKeyError(error)) {
              throw error;
            }

            if (input.employeeCode !== undefined) {
              throw new EmploymentProfileConflictError(
                "Employee code or linked user already exists on a non-archived employment profile",
              );
            }

            if (attempt >= maxAttempts) {
              throw new EmploymentProfileConflictError(
                "Generated employee code conflict detected on create",
              );
            }
          }
        }

        await this.recordAudit({
          actor,
          permission,
          employmentProfileId: created.id,
          mutationType: operation,
          metadata: {
            employeeCode: created.employeeCode,
            orgUnitId: created.orgUnitId,
            managerEmploymentProfileId: null,
            linkedUserId: created.linkedUserId,
            recruiterEmploymentProfileId:
              created.recruiterEmploymentProfileId,
            hrOwnerEmploymentProfileId:
              created.hrOwnerEmploymentProfileId,
            onboardingOwnerEmploymentProfileId:
              created.onboardingOwnerEmploymentProfileId,
            sourcedByEmploymentProfileId:
              created.sourcedByEmploymentProfileId,
          },
          session,
        });

        return toEmploymentProfileMutationView(
          created,
        );
      },
      (result) => ({
        employmentProfileId: result.id,
        employeeCode: result.employeeCode,
        employmentStatus: result.employmentStatus,
      }),
    );
  }

  async updateEmploymentProfileCore(
    actor: Actor,
    command: UpdateEmploymentProfileCoreCommand,
  ): Promise<EmploymentProfileMutationResult> {
    const operation = "employment-profile.update-core";
    const permission = this.assertPermission(
      actor,
      Permission.EMPLOYMENT_PROFILE_UPDATE,
    );
    const employmentProfileId =
      normalizeRequiredText(
        command.employmentProfileId,
        "employmentProfileId",
      );
    rejectLegacyManagerField(command, "EmploymentProfile update");

    const hasLegalName =
      command.legalName !== undefined;
    const hasDisplayName =
      command.displayName !== undefined;
    const hasEmploymentKind =
      command.employmentKind !== undefined;
    const hasJobTitle =
      command.jobTitle !== undefined;
    const hasExternalRef =
      command.externalRef !== undefined;
    const hasTitleDescription =
      command.titleDescription !== undefined;
    const hasRecruiterEmploymentProfileId =
      command.recruiterEmploymentProfileId !== undefined;
    const hasHrOwnerEmploymentProfileId =
      command.hrOwnerEmploymentProfileId !== undefined;
    const hasOnboardingOwnerEmploymentProfileId =
      command.onboardingOwnerEmploymentProfileId !==
      undefined;
    const hasSourcedByEmploymentProfileId =
      command.sourcedByEmploymentProfileId !== undefined;
    const hasHiredAt = command.hiredAt !== undefined;
    const hasOnboardedAt =
      command.onboardedAt !== undefined;

    if (
      !hasLegalName &&
      !hasDisplayName &&
      !hasEmploymentKind &&
      !hasJobTitle &&
      !hasExternalRef &&
      !hasTitleDescription &&
      !hasRecruiterEmploymentProfileId &&
      !hasHrOwnerEmploymentProfileId &&
      !hasOnboardingOwnerEmploymentProfileId &&
      !hasSourcedByEmploymentProfileId &&
      !hasHiredAt &&
      !hasOnboardedAt
    ) {
      throw new EmploymentProfileValidationError(
        "At least one field must be provided for update",
      );
    }

    const legalName = hasLegalName
      ? normalizePersonName(
          command.legalName,
          "legalName",
        )
      : undefined;
    const displayName = hasDisplayName
      ? normalizePersonName(
          command.displayName,
          "displayName",
        )
      : undefined;
    const employmentKind = hasEmploymentKind
      ? normalizeEmploymentKind(
          command.employmentKind,
        )
      : undefined;
    const jobTitle = hasJobTitle
      ? normalizeDisplayText(
          command.jobTitle,
          "jobTitle",
        )
      : undefined;
    const externalRef = hasExternalRef
      ? normalizeNullablePatchText(
          command.externalRef,
          "externalRef",
        )
      : undefined;
    const titleDescription = hasTitleDescription
      ? normalizeNullablePatchText(
          command.titleDescription,
          "titleDescription",
        )
      : undefined;
    const recruiterEmploymentProfileId =
      hasRecruiterEmploymentProfileId
        ? normalizeRequiredNullableId(
            command.recruiterEmploymentProfileId,
            "recruiterEmploymentProfileId",
          )
        : undefined;
    const hrOwnerEmploymentProfileId =
      hasHrOwnerEmploymentProfileId
        ? normalizeRequiredNullableId(
            command.hrOwnerEmploymentProfileId,
            "hrOwnerEmploymentProfileId",
          )
        : undefined;
    const onboardingOwnerEmploymentProfileId =
      hasOnboardingOwnerEmploymentProfileId
        ? normalizeRequiredNullableId(
            command.onboardingOwnerEmploymentProfileId,
            "onboardingOwnerEmploymentProfileId",
          )
        : undefined;
    const sourcedByEmploymentProfileId =
      hasSourcedByEmploymentProfileId
        ? normalizeRequiredNullableId(
            command.sourcedByEmploymentProfileId,
            "sourcedByEmploymentProfileId",
          )
        : undefined;
    const hiredAt = hasHiredAt
      ? normalizeNullableCanonicalCalendarDateValue(
          command.hiredAt,
          "hiredAt",
        )
      : undefined;
    const onboardedAt = hasOnboardedAt
      ? normalizeNullableCanonicalCalendarDateValue(
          command.onboardedAt,
          "onboardedAt",
        )
      : undefined;

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        employmentProfileId:
          readOptionalLogString(
            command.employmentProfileId,
          ),
      },
      async (session) => {
        const current =
          await this.requireEmploymentProfile(
            employmentProfileId,
            session,
          );
        await this.requireManagedOrgUnitAuthority(
          actor,
          Permission.EMPLOYMENT_PROFILE_UPDATE,
          current.orgUnitId,
        );

        if (
          current.employmentStatus === "ARCHIVED"
        ) {
          throw new EmploymentProfileStateError(
            `Archived employment profile cannot be updated: ${employmentProfileId}`,
          );
        }

        const patch =
          buildEmploymentProfileCorePatch({
            current,
            employmentProfileId,
            legalName,
            displayName,
            employmentKind,
            jobTitle,
            externalRef,
            titleDescription,
            recruiterEmploymentProfileId,
            hrOwnerEmploymentProfileId,
            onboardingOwnerEmploymentProfileId,
            sourcedByEmploymentProfileId,
            hiredAt,
            onboardedAt,
          });
        const changedFields = Object.keys(
          patch,
        ).filter((field) => field !== "updatedAt");

        if (changedFields.length === 0) {
          throw new EmploymentProfileValidationError(
            "At least one changed field is required",
          );
        }

        await this.assertEmploymentProfileAttributionEligible(
          patch.recruiterEmploymentProfileId,
          "recruiterEmploymentProfileId",
          session,
        );
        await this.assertEmploymentProfileAttributionEligible(
          patch.hrOwnerEmploymentProfileId,
          "hrOwnerEmploymentProfileId",
          session,
        );
        await this.assertEmploymentProfileAttributionEligible(
          patch.onboardingOwnerEmploymentProfileId,
          "onboardingOwnerEmploymentProfileId",
          session,
        );
        await this.assertEmploymentProfileAttributionEligible(
          patch.sourcedByEmploymentProfileId,
          "sourcedByEmploymentProfileId",
          session,
        );

        const updated =
          await this.repository.updateCore(
            patch,
            session,
          );

        if (!updated) {
          throw new EmploymentProfileConflictError(
            `Failed to update employment profile: ${employmentProfileId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          employmentProfileId,
          mutationType: operation,
          metadata: {
            changedFields,
          },
          session,
        });

        return toEmploymentProfileMutationView(
          updated,
        );
      },
      (result) => ({
        employmentProfileId: result.id,
        employmentStatus: result.employmentStatus,
      }),
    );
  }

  async assignEmploymentProfileOrgUnit(
    actor: Actor,
    command: AssignEmploymentProfileOrgUnitCommand,
  ): Promise<EmploymentProfileMutationResult> {
    const operation =
      "employment-profile.assign-org-unit";
    const permission = this.assertPermission(
      actor,
      Permission.EMPLOYMENT_PROFILE_MANAGE_ORG_ASSIGNMENT,
    );
    const employmentProfileId =
      normalizeRequiredText(
        command.employmentProfileId,
        "employmentProfileId",
      );
    const newOrgUnitId = normalizeRequiredText(
      command.newOrgUnitId,
      "newOrgUnitId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        employmentProfileId:
          readOptionalLogString(
            command.employmentProfileId,
          ),
        newOrgUnitId: readOptionalLogString(
          command.newOrgUnitId,
        ),
      },
      async (session, controls) => {
        const current =
          await this.requireEmploymentProfile(
            employmentProfileId,
            session,
          );
        if (
          current.employmentStatus === "ARCHIVED"
        ) {
          throw new EmploymentProfileStateError(
            `Archived employment profile cannot be reassigned: ${employmentProfileId}`,
          );
        }

        if (current.orgUnitId === newOrgUnitId) {
          controls.markExplicitNoOpSuccess();
          return toEmploymentProfileMutationView(
            current,
          );
        }

        await this.assertOrgUnitActive(
          newOrgUnitId,
          session,
        );

        const updated =
          await this.repository.assignOrgUnit(
            {
              employmentProfileId,
              orgUnitId: newOrgUnitId,
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new EmploymentProfileConflictError(
            `Failed to assign org unit: ${employmentProfileId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          employmentProfileId,
          mutationType: operation,
          metadata: {
            previousOrgUnitId: current.orgUnitId,
            newOrgUnitId,
          },
          session,
        });

        return toEmploymentProfileMutationView(
          updated,
        );
      },
      (result) => ({
        employmentProfileId: result.id,
        orgUnitId: result.orgUnitId,
      }),
    );
  }

  async assignEmploymentProfileManager(
    actor: Actor,
    command: AssignEmploymentProfileManagerCommand,
  ): Promise<EmploymentProfileMutationResult> {
    this.assertPermission(
      actor,
      Permission.EMPLOYMENT_PROFILE_MANAGE_MANAGER_ASSIGNMENT,
    );
    normalizeRequiredText(
      command.employmentProfileId,
      "employmentProfileId",
    );
    normalizeRequiredNullableId(
      command.newManagerEmploymentProfileId,
      "newManagerEmploymentProfileId",
    );
    throw new EmploymentProfileValidationError(
      "EmploymentProfile manager writes must use central responsibility assignments",
    );
  }

  async linkEmploymentProfileUser(
    actor: Actor,
    command: LinkEmploymentProfileUserCommand,
  ): Promise<EmploymentProfileMutationResult> {
    const operation =
      "employment-profile.link-user";
    const permission = this.assertPermission(
      actor,
      Permission.EMPLOYMENT_PROFILE_MANAGE_USER_LINKAGE,
    );
    const employmentProfileId =
      normalizeRequiredText(
        command.employmentProfileId,
        "employmentProfileId",
      );
    const linkedUserId = normalizeRequiredText(
      command.linkedUserId,
      "linkedUserId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        employmentProfileId:
          readOptionalLogString(
            command.employmentProfileId,
          ),
        linkedUserId: readOptionalLogString(
          command.linkedUserId,
        ),
      },
      async (session, controls) => {
        const current =
          await this.requireEmploymentProfile(
            employmentProfileId,
            session,
          );
        if (
          current.employmentStatus === "ARCHIVED"
        ) {
          throw new EmploymentProfileStateError(
            `Archived employment profile cannot link user: ${employmentProfileId}`,
          );
        }

        if (current.linkedUserId === linkedUserId) {
          controls.markExplicitNoOpSuccess();
          return toEmploymentProfileMutationView(
            current,
          );
        }

        await this.assertLinkedUserEligible(
          linkedUserId,
          current.id,
          session,
        );

        let updated: EmploymentProfileRecord | null;

        try {
          updated = await this.repository.setLinkedUser(
            {
              employmentProfileId,
              linkedUserId,
              updatedAt: Date.now(),
            },
            session,
          );
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            throw new EmploymentProfileConflictError(
              `Linked user already belongs to another non-archived employment profile: ${linkedUserId}`,
            );
          }

          throw error;
        }

        if (!updated) {
          throw new EmploymentProfileConflictError(
            `Failed to link user: ${employmentProfileId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          employmentProfileId,
          mutationType: operation,
          metadata: {
            previousLinkedUserId:
              current.linkedUserId,
            newLinkedUserId: linkedUserId,
          },
          session,
        });

        return toEmploymentProfileMutationView(
          updated,
        );
      },
      (result) => ({
        employmentProfileId: result.id,
        linkedUserId: result.linkedUserId,
      }),
    );
  }

  async unlinkEmploymentProfileUser(
    actor: Actor,
    command: UnlinkEmploymentProfileUserCommand,
  ): Promise<EmploymentProfileMutationResult> {
    const operation =
      "employment-profile.unlink-user";
    const permission = this.assertPermission(
      actor,
      Permission.EMPLOYMENT_PROFILE_MANAGE_USER_LINKAGE,
    );
    const employmentProfileId =
      normalizeRequiredText(
        command.employmentProfileId,
        "employmentProfileId",
      );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        employmentProfileId:
          readOptionalLogString(
            command.employmentProfileId,
          ),
      },
      async (session, controls) => {
        const current =
          await this.requireEmploymentProfile(
            employmentProfileId,
            session,
          );
        if (
          current.employmentStatus === "ARCHIVED"
        ) {
          throw new EmploymentProfileStateError(
            `Archived employment profile cannot unlink user: ${employmentProfileId}`,
          );
        }

        if (current.linkedUserId === null) {
          controls.markExplicitNoOpSuccess();
          return toEmploymentProfileMutationView(
            current,
          );
        }

        const updated =
          await this.repository.setLinkedUser(
            {
              employmentProfileId,
              linkedUserId: null,
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new EmploymentProfileConflictError(
            `Failed to unlink user: ${employmentProfileId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          employmentProfileId,
          mutationType: operation,
          metadata: {
            previousLinkedUserId:
              current.linkedUserId,
            newLinkedUserId: null,
          },
          session,
        });

        return toEmploymentProfileMutationView(
          updated,
        );
      },
      (result) => ({
        employmentProfileId: result.id,
        linkedUserId: result.linkedUserId,
      }),
    );
  }

  async placeEmploymentProfileOnLeave(
    actor: Actor,
    command: PlaceEmploymentProfileOnLeaveCommand,
  ): Promise<EmploymentProfileMutationResult> {
    const operation =
      "employment-profile.place-on-leave";
    const permission = this.assertPermission(
      actor,
      Permission.EMPLOYMENT_PROFILE_MANAGE_LIFECYCLE,
    );
    const employmentProfileId =
      normalizeRequiredText(
        command.employmentProfileId,
        "employmentProfileId",
      );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        employmentProfileId:
          readOptionalLogString(
            command.employmentProfileId,
          ),
      },
      async (session) => {
        const current =
          await this.requireEmploymentProfile(
            employmentProfileId,
            session,
          );
        await this.requireManagedOrgUnitAuthority(
          actor,
          Permission.EMPLOYMENT_PROFILE_MANAGE_LIFECYCLE,
          current.orgUnitId,
        );

        if (
          current.employmentStatus !== "ACTIVE"
        ) {
          throw new EmploymentProfileStateError(
            `Employment profile ${employmentProfileId} cannot transition from ${current.employmentStatus} to ON_LEAVE`,
          );
        }

        const evaluationTime = Date.now();
        await this.assertNoLiveScheduledWorkShifts(
          employmentProfileId,
          "place on leave",
          evaluationTime,
          session,
        );
        await this.assertNoLiveEventBindings(
          employmentProfileId,
          "place on leave",
          evaluationTime,
          session,
        );

        const updated =
          await this.repository.transitionLifecycle(
            {
              employmentProfileId,
              fromStatuses: ["ACTIVE"],
              toStatus: "ON_LEAVE",
              employmentEndDate: null,
              updatedAt: evaluationTime,
            },
            session,
          );

        if (!updated) {
          throw new EmploymentProfileConflictError(
            `Employment profile state transition conflict for ${employmentProfileId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          employmentProfileId,
          mutationType: operation,
          metadata: {
            previousEmploymentStatus:
              current.employmentStatus,
            nextEmploymentStatus:
              updated.employmentStatus,
          },
          session,
        });

        return toEmploymentProfileMutationView(
          updated,
        );
      },
      (result) => ({
        employmentProfileId: result.id,
        employmentStatus: result.employmentStatus,
      }),
    );
  }

  async returnEmploymentProfileFromLeave(
    actor: Actor,
    command: ReturnEmploymentProfileFromLeaveCommand,
  ): Promise<EmploymentProfileMutationResult> {
    const operation =
      "employment-profile.return-from-leave";
    const permission = this.assertPermission(
      actor,
      Permission.EMPLOYMENT_PROFILE_MANAGE_LIFECYCLE,
    );
    const employmentProfileId =
      normalizeRequiredText(
        command.employmentProfileId,
        "employmentProfileId",
      );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        employmentProfileId:
          readOptionalLogString(
            command.employmentProfileId,
          ),
      },
      async (session) => {
        const current =
          await this.requireEmploymentProfile(
            employmentProfileId,
            session,
          );
        await this.requireManagedOrgUnitAuthority(
          actor,
          Permission.EMPLOYMENT_PROFILE_MANAGE_LIFECYCLE,
          current.orgUnitId,
        );

        if (
          current.employmentStatus !== "ON_LEAVE"
        ) {
          throw new EmploymentProfileStateError(
            `Employment profile ${employmentProfileId} cannot transition from ${current.employmentStatus} to ACTIVE`,
          );
        }

        await this.assertOrgUnitActive(
          current.orgUnitId,
          session,
        );

        const updated =
          await this.repository.transitionLifecycle(
            {
              employmentProfileId,
              fromStatuses: ["ON_LEAVE"],
              toStatus: "ACTIVE",
              employmentEndDate: null,
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new EmploymentProfileConflictError(
            `Employment profile state transition conflict for ${employmentProfileId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          employmentProfileId,
          mutationType: operation,
          metadata: {
            previousEmploymentStatus:
              current.employmentStatus,
            nextEmploymentStatus:
              updated.employmentStatus,
          },
          session,
        });

        return toEmploymentProfileMutationView(
          updated,
        );
      },
      (result) => ({
        employmentProfileId: result.id,
        employmentStatus: result.employmentStatus,
      }),
    );
  }

  async suspendEmploymentProfile(
    actor: Actor,
    command: SuspendEmploymentProfileCommand,
  ): Promise<EmploymentProfileMutationResult> {
    const operation =
      "employment-profile.suspend";
    const permission = this.assertPermission(
      actor,
      Permission.EMPLOYMENT_PROFILE_MANAGE_LIFECYCLE,
    );
    const employmentProfileId =
      normalizeRequiredText(
        command.employmentProfileId,
        "employmentProfileId",
      );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        employmentProfileId:
          readOptionalLogString(
            command.employmentProfileId,
          ),
      },
      async (session) => {
        const current =
          await this.requireEmploymentProfile(
            employmentProfileId,
            session,
          );
        await this.requireManagedOrgUnitAuthority(
          actor,
          Permission.EMPLOYMENT_PROFILE_MANAGE_LIFECYCLE,
          current.orgUnitId,
        );

        if (
          current.employmentStatus !== "ACTIVE" &&
          current.employmentStatus !== "ON_LEAVE"
        ) {
          throw new EmploymentProfileStateError(
            `Employment profile ${employmentProfileId} cannot transition from ${current.employmentStatus} to SUSPENDED`,
          );
        }

        await this.assertHasNoNonArchivedDirectReports(
          employmentProfileId,
          "suspend",
          session,
        );
        await this.assertTalentLifecycleGuards(
          employmentProfileId,
          "suspend",
          session,
        );
        const evaluationTime = Date.now();
        await this.assertNoLiveScheduledWorkShifts(
          employmentProfileId,
          "suspend",
          evaluationTime,
          session,
        );
        await this.assertNoLiveEventBindings(
          employmentProfileId,
          "suspend",
          evaluationTime,
          session,
        );

        const updated =
          await this.repository.transitionLifecycle(
            {
              employmentProfileId,
              fromStatuses: [
                current.employmentStatus,
              ],
              toStatus: "SUSPENDED",
              employmentEndDate: null,
              updatedAt: evaluationTime,
            },
            session,
          );

        if (!updated) {
          throw new EmploymentProfileConflictError(
            `Employment profile state transition conflict for ${employmentProfileId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          employmentProfileId,
          mutationType: operation,
          metadata: {
            previousEmploymentStatus:
              current.employmentStatus,
            nextEmploymentStatus:
              updated.employmentStatus,
          },
          session,
        });

        return toEmploymentProfileMutationView(
          updated,
        );
      },
      (result) => ({
        employmentProfileId: result.id,
        employmentStatus: result.employmentStatus,
      }),
    );
  }

  async reactivateEmploymentProfile(
    actor: Actor,
    command: ReactivateEmploymentProfileCommand,
  ): Promise<EmploymentProfileMutationResult> {
    const operation =
      "employment-profile.reactivate";
    const permission = this.assertPermission(
      actor,
      Permission.EMPLOYMENT_PROFILE_MANAGE_LIFECYCLE,
    );
    const employmentProfileId =
      normalizeRequiredText(
        command.employmentProfileId,
        "employmentProfileId",
      );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        employmentProfileId:
          readOptionalLogString(
            command.employmentProfileId,
          ),
      },
      async (session) => {
        const current =
          await this.requireEmploymentProfile(
            employmentProfileId,
            session,
          );
        await this.requireManagedOrgUnitAuthority(
          actor,
          Permission.EMPLOYMENT_PROFILE_MANAGE_LIFECYCLE,
          current.orgUnitId,
        );

        if (
          current.employmentStatus !==
          "SUSPENDED"
        ) {
          throw new EmploymentProfileStateError(
            `Employment profile ${employmentProfileId} cannot transition from ${current.employmentStatus} to ACTIVE`,
          );
        }

        await this.assertOrgUnitActive(
          current.orgUnitId,
          session,
        );

        const updated =
          await this.repository.transitionLifecycle(
            {
              employmentProfileId,
              fromStatuses: ["SUSPENDED"],
              toStatus: "ACTIVE",
              employmentEndDate: null,
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new EmploymentProfileConflictError(
            `Employment profile state transition conflict for ${employmentProfileId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          employmentProfileId,
          mutationType: operation,
          metadata: {
            previousEmploymentStatus:
              current.employmentStatus,
            nextEmploymentStatus:
              updated.employmentStatus,
          },
          session,
        });

        return toEmploymentProfileMutationView(
          updated,
        );
      },
      (result) => ({
        employmentProfileId: result.id,
        employmentStatus: result.employmentStatus,
      }),
    );
  }

  async terminateEmploymentProfile(
    actor: Actor,
    command: TerminateEmploymentProfileCommand,
  ): Promise<EmploymentProfileMutationResult> {
    const operation =
      "employment-profile.terminate";
    const permission = this.assertPermission(
      actor,
      Permission.EMPLOYMENT_PROFILE_MANAGE_LIFECYCLE,
    );
    const employmentProfileId =
      normalizeRequiredText(
        command.employmentProfileId,
        "employmentProfileId",
      );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        employmentProfileId:
          readOptionalLogString(
            command.employmentProfileId,
          ),
      },
      async (session) => {
        const current =
          await this.requireEmploymentProfile(
            employmentProfileId,
            session,
          );
        if (
          current.employmentStatus !== "ACTIVE" &&
          current.employmentStatus !== "ON_LEAVE" &&
          current.employmentStatus !== "SUSPENDED"
        ) {
          throw new EmploymentProfileStateError(
            `Employment profile ${employmentProfileId} cannot transition from ${current.employmentStatus} to TERMINATED`,
          );
        }

        await this.assertHasNoNonArchivedDirectReports(
          employmentProfileId,
          "terminate",
          session,
        );
        await this.assertTalentLifecycleGuards(
          employmentProfileId,
          "terminate",
          session,
        );

        const evaluationTime = Date.now();
        await this.assertNoLiveScheduledWorkShifts(
          employmentProfileId,
          "terminate",
          evaluationTime,
          session,
        );
        await this.assertNoLiveEventBindings(
          employmentProfileId,
          "terminate",
          evaluationTime,
          session,
        );
        const employmentEndDate =
          normalizeCanonicalCalendarDateValue(
            command.employmentEndDate,
            "employmentEndDate",
          );
        assertCalendarDateNotLaterThanEvaluationTime(
          employmentEndDate,
          "employmentEndDate",
          evaluationTime,
        );

        if (
          employmentEndDate <
          current.employmentStartDate
        ) {
          throw new EmploymentProfileValidationError(
            "employmentEndDate must not be before employmentStartDate",
          );
        }

        const updated =
          await this.repository.transitionLifecycle(
            {
              employmentProfileId,
              fromStatuses: [
                current.employmentStatus,
              ],
              toStatus: "TERMINATED",
              contractStatus: "TERMINATED",
              employmentEndDate,
              updatedAt: evaluationTime,
            },
            session,
          );

        if (!updated) {
          throw new EmploymentProfileConflictError(
            `Employment profile state transition conflict for ${employmentProfileId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          employmentProfileId,
          mutationType: operation,
          metadata: {
            previousEmploymentStatus:
              current.employmentStatus,
            nextEmploymentStatus:
              updated.employmentStatus,
            previousContractStatus:
              current.contractStatus,
            nextContractStatus:
              updated.contractStatus,
            employmentEndDate,
          },
          session,
        });

        return toEmploymentProfileMutationView(
          updated,
        );
      },
      (result) => ({
        employmentProfileId: result.id,
        employmentStatus: result.employmentStatus,
        contractStatus: result.contractStatus,
      }),
    );
  }

  async archiveEmploymentProfile(
    actor: Actor,
    command: ArchiveEmploymentProfileCommand,
  ): Promise<EmploymentProfileMutationResult> {
    const operation =
      "employment-profile.archive";
    const permission = this.assertPermission(
      actor,
      Permission.EMPLOYMENT_PROFILE_MANAGE_LIFECYCLE,
    );
    const employmentProfileId =
      normalizeRequiredText(
        command.employmentProfileId,
        "employmentProfileId",
      );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        employmentProfileId:
          readOptionalLogString(
            command.employmentProfileId,
          ),
      },
      async (session) => {
        const current =
          await this.requireEmploymentProfile(
            employmentProfileId,
            session,
          );
        await this.requireManagedOrgUnitAuthority(
          actor,
          Permission.EMPLOYMENT_PROFILE_MANAGE_LIFECYCLE,
          current.orgUnitId,
        );

        if (
          current.employmentStatus !==
          "TERMINATED"
        ) {
          throw new EmploymentProfileStateError(
            `Employment profile ${employmentProfileId} cannot transition from ${current.employmentStatus} to ARCHIVED`,
          );
        }

        await this.assertHasNoNonArchivedDirectReports(
          employmentProfileId,
          "archive",
          session,
        );
        await this.assertTalentLifecycleGuards(
          employmentProfileId,
          "archive",
          session,
        );
        const evaluationTime = Date.now();
        await this.assertNoLiveScheduledWorkShifts(
          employmentProfileId,
          "archive",
          evaluationTime,
          session,
        );
        await this.assertNoLiveEventBindings(
          employmentProfileId,
          "archive",
          evaluationTime,
          session,
        );

        const updated =
          await this.repository.transitionLifecycle(
            {
              employmentProfileId,
              fromStatuses: ["TERMINATED"],
              toStatus: "ARCHIVED",
              employmentEndDate:
                current.employmentEndDate,
              updatedAt: evaluationTime,
            },
            session,
          );

        if (!updated) {
          throw new EmploymentProfileConflictError(
            `Employment profile state transition conflict for ${employmentProfileId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          employmentProfileId,
          mutationType: operation,
          metadata: {
            previousEmploymentStatus:
              current.employmentStatus,
            nextEmploymentStatus:
              updated.employmentStatus,
          },
          session,
        });

        return toEmploymentProfileMutationView(
          updated,
        );
      },
      (result) => ({
        employmentProfileId: result.id,
        employmentStatus: result.employmentStatus,
      }),
    );
  }

  async updateEmploymentProfileContractStatus(
    actor: Actor,
    command: UpdateEmploymentProfileContractStatusCommand,
  ): Promise<EmploymentProfileMutationResult> {
    const operation =
      "employment-profile.update-contract-status";
    const permission = this.assertPermission(
      actor,
      Permission.EMPLOYMENT_PROFILE_UPDATE,
    );
    const employmentProfileId =
      normalizeRequiredText(
        command.employmentProfileId,
        "employmentProfileId",
      );
    const newContractStatus =
      normalizeContractStatus(
        command.newContractStatus,
      );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        employmentProfileId:
          readOptionalLogString(
            command.employmentProfileId,
          ),
        newContractStatus:
          readOptionalLogString(
            command.newContractStatus,
          ),
      },
      async (session, controls) => {
        const current =
          await this.requireEmploymentProfile(
            employmentProfileId,
            session,
          );

        if (
          current.employmentStatus === "ARCHIVED"
        ) {
          throw new EmploymentProfileStateError(
            `Archived employment profile cannot update contract status: ${employmentProfileId}`,
          );
        }

        if (
          current.contractStatus === newContractStatus
        ) {
          controls.markExplicitNoOpSuccess();
          return toEmploymentProfileMutationView(
            current,
          );
        }

        assertContractStatusTransitionAllowed(
          current.contractStatus,
          newContractStatus,
          current.employmentStatus,
        );

        const updated =
          await this.repository.updateContractStatus(
            {
              employmentProfileId,
              contractStatus: newContractStatus,
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new EmploymentProfileConflictError(
            `Failed to update contract status: ${employmentProfileId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          employmentProfileId,
          mutationType: operation,
          metadata: {
            previousContractStatus:
              current.contractStatus,
            newContractStatus,
          },
          session,
        });

        return toEmploymentProfileMutationView(
          updated,
        );
      },
      (result) => ({
        employmentProfileId: result.id,
        contractStatus: result.contractStatus,
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

  private async requireEmploymentProfile(
    employmentProfileId: string,
    session: ClientSession,
  ): Promise<EmploymentProfileRecord> {
    const employmentProfile =
      await this.repository.findById(
        employmentProfileId,
        session,
      );

    if (!employmentProfile) {
      throw new EmploymentProfileNotFoundError(
        employmentProfileId,
      );
    }

    assertEmploymentProfileRecordInvariant(
      employmentProfile,
    );

    return employmentProfile;
  }

  private async requireManagedOrgUnitAuthority(
    actor: Actor,
    permission: Permission,
    orgUnitId: string,
  ): Promise<void> {
    await requireAdminObjectScopeAuthority({
      actor,
      permission,
      scope: { scopeType: "managedOrgUnit", targetId: orgUnitId },
      authority: this.structuredAuthority,
      error: new EmploymentProfilePermissionScopeError(
        `Employment profile operation requires managedOrgUnit scope: ${orgUnitId}`,
      ),
    });
  }

  private async allocateGeneratedCode(
    session: ClientSession,
  ): Promise<string> {
    const maxExisting =
      await this.repository.findMaxGeneratedCodeSequence(
        EMPLOYMENT_PROFILE_CODE_POLICY,
        session,
      );
    await this.codeSequenceRepository.ensureAtLeast(
      EMPLOYMENT_PROFILE_CODE_POLICY.moduleKey,
      EMPLOYMENT_PROFILE_CODE_POLICY.bucket,
      maxExisting,
      session,
    );
    const next =
      await this.codeSequenceRepository.allocateNext(
        EMPLOYMENT_PROFILE_CODE_POLICY.moduleKey,
        EMPLOYMENT_PROFILE_CODE_POLICY.bucket,
        session,
      );

    return formatBusinessCode(
      EMPLOYMENT_PROFILE_CODE_POLICY,
      next,
    );
  }

  private async assertOrgUnitActive(
    orgUnitId: string,
    session: ClientSession,
  ): Promise<void> {
    const orgUnit =
      await this.orgUnitReadonlyAccess.findById(
        orgUnitId,
        session,
      );

    if (!orgUnit) {
      throw new EmploymentProfileInvalidOrgAssignmentError(
        `Org unit does not exist: ${orgUnitId}`,
      );
    }

    if (orgUnit.status !== "ACTIVE") {
      throw new EmploymentProfileInvalidOrgAssignmentError(
        `Org unit must be ACTIVE: ${orgUnitId}`,
      );
    }
  }

  private async assertLinkedUserEligible(
    linkedUserId: string,
    currentEmploymentProfileId: string | null,
    session: ClientSession,
  ): Promise<void> {
    const user =
      await this.userReadonlyAccess.findById(
        linkedUserId,
        session,
      );

    if (!user) {
      throw new EmploymentProfileInvalidUserLinkageError(
        `Linked user does not exist or is not eligible: ${linkedUserId}`,
      );
    }

    if (user.accountStatus !== "ACTIVE") {
      throw new EmploymentProfileInvalidUserLinkageError(
        `Linked user must be ACTIVE: ${linkedUserId}`,
      );
    }

    const existingLinkedProfile =
      await this.repository.findNonArchivedByLinkedUserId(
        linkedUserId,
        session,
      );

    if (
      existingLinkedProfile &&
      existingLinkedProfile.id !==
        currentEmploymentProfileId
    ) {
      throw new EmploymentProfileConflictError(
        `Linked user already belongs to another non-archived employment profile: ${linkedUserId}`,
      );
    }
  }

  private async assertEmploymentProfileAttributionEligible(
    employmentProfileId: string | null | undefined,
    field: string,
    session: ClientSession,
  ): Promise<void> {
    if (employmentProfileId === undefined || employmentProfileId === null) {
      return;
    }

    const employmentProfile =
      await this.repository.findById(
        employmentProfileId,
        session,
      );

    if (!employmentProfile) {
      throw new EmploymentProfileValidationError(
        `${field} must reference an EmploymentProfile record`,
      );
    }

    if (
      employmentProfile.employmentStatus === "ACTIVE" ||
      employmentProfile.employmentStatus === "ON_LEAVE"
    ) {
      return;
    }

    throw new EmploymentProfileStateError(
      `${field} must reference an ACTIVE or ON_LEAVE EmploymentProfile record: ${employmentProfileId}`,
    );
  }

  private async assertManagerAssignmentHasNoCycle(
    employmentProfileId: string,
    managerEmploymentProfileId: string,
    session: ClientSession,
  ): Promise<void> {
    let cursorId: string | null =
      managerEmploymentProfileId;
    const visited = new Set<string>();

    while (cursorId !== null) {
      if (cursorId === employmentProfileId) {
        throw new EmploymentProfileManagerCycleError(
          `Manager assignment would create a reporting cycle for ${employmentProfileId}`,
        );
      }

      if (visited.has(cursorId)) {
        throw new EmploymentProfileManagerCycleError(
          `Manager assignment encountered an existing cycle at ${cursorId}`,
        );
      }

      visited.add(cursorId);

      const current =
        await this.repository.findById(
          cursorId,
          session,
        );

      if (!current) {
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Manager chain reference missing employment profile: ${cursorId}`,
        );
      }

      assertEmploymentProfileRecordInvariant(
        current,
      );
      cursorId =
        current.managerEmploymentProfileId;
    }
  }

  private async assertHasNoNonArchivedDirectReports(
    employmentProfileId: string,
    operation:
      | "suspend"
      | "terminate"
      | "archive",
    session: ClientSession,
  ): Promise<void> {
    const hasDirectReports =
      await this.repository.hasNonArchivedDirectReports(
        employmentProfileId,
        session,
      );

    if (!hasDirectReports) {
      return;
    }

    throw new EmploymentProfileStateError(
      `Cannot ${operation} employment profile ${employmentProfileId} while non-archived direct reports exist`,
    );
  }

  private async assertTalentLifecycleGuards(
    employmentProfileId: string,
    operation:
      | "suspend"
      | "terminate"
      | "archive",
    session: ClientSession,
  ): Promise<void> {
    const hasManagedTalents =
      await this.talentReadonlyAccess.hasNonArchivedTalentsManagedByEmploymentProfile(
        employmentProfileId,
        session,
      );

    if (hasManagedTalents) {
      throw new EmploymentProfileStateError(
        `Cannot ${operation} employment profile ${employmentProfileId} while non-archived talents reference it as talent manager`,
      );
    }

    if (operation === "suspend") {
      return;
    }

    const hasLinkedInternalTalent =
      await this.talentReadonlyAccess.hasNonArchivedInternalTalentLinkedToEmploymentProfile(
        employmentProfileId,
        session,
      );

    if (hasLinkedInternalTalent) {
      throw new EmploymentProfileStateError(
        `Cannot ${operation} employment profile ${employmentProfileId} while non-archived internal talent remains linked`,
      );
    }
  }

  private async assertNoLiveScheduledWorkShifts(
    employmentProfileId: string,
    operation:
      | "place on leave"
      | "suspend"
      | "terminate"
      | "archive",
    evaluationTime: number,
    session: ClientSession,
  ): Promise<void> {
    const hasLiveScheduledWorkShift =
      await this.workScheduleReadonlyAccess.hasLiveScheduledShiftForEmploymentProfile(
        employmentProfileId,
        evaluationTime,
        session,
      );

    if (!hasLiveScheduledWorkShift) {
      return;
    }

    throw new EmploymentProfileStateError(
      `Cannot ${operation} employment profile ${employmentProfileId} while live scheduled work shifts exist`,
    );
  }

  private async assertNoLiveEventBindings(
    employmentProfileId: string,
    operation:
      | "place on leave"
      | "suspend"
      | "terminate"
      | "archive",
    evaluationTime: number,
    session: ClientSession,
  ): Promise<void> {
    const hasLiveEventBinding =
      await this.eventAssignmentReadonlyAccess.hasLiveEventBindingForEmploymentProfile(
        employmentProfileId,
        evaluationTime,
        session,
      );

    if (!hasLiveEventBinding) {
      return;
    }

    throw new EmploymentProfileStateError(
      `Cannot ${operation} employment profile ${employmentProfileId} while live event bindings exist`,
    );
  }

  private async recordAudit(params: {
    readonly actor: Actor;
    readonly permission: PermissionContract;
    readonly employmentProfileId: string;
    readonly mutationType: AuthoritativeAdminMutationIdentity;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly session: ClientSession;
  }): Promise<void> {
    await this.audit.record(
      params.actor,
      params.permission,
      params.employmentProfileId,
      {
        mutationType: params.mutationType,
        targetId: params.employmentProfileId,
        targetType: "employmentProfile",
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
            classifyEmploymentProfileMutationFailure(
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

interface NormalizedCreateCommand {
  readonly employeeCode: string | undefined;
  readonly legalName: string;
  readonly normalizedLegalName: string;
  readonly displayName: string;
  readonly normalizedDisplayName: string;
  readonly employmentKind: EmploymentKind;
  readonly jobTitle: string;
  readonly titleDescription: string | null;
  readonly externalRef: string | null;
  readonly orgUnitId: string;
  readonly linkedUserId: string | null;
  readonly recruiterEmploymentProfileId: string | null;
  readonly hrOwnerEmploymentProfileId: string | null;
  readonly onboardingOwnerEmploymentProfileId: string | null;
  readonly sourcedByEmploymentProfileId: string | null;
  readonly contractStatus: EmploymentContractStatus;
  readonly employmentStartDate: number;
  readonly hiredAt: number | null;
  readonly onboardedAt: number | null;
}

function normalizeCreateCommand(
  command: CreateEmploymentProfileCommand,
): NormalizedCreateCommand {
  rejectLegacyManagerField(command, "EmploymentProfile create");
  const legalName = normalizePersonName(
    command.legalName,
    "legalName",
  );
  const displayName = normalizePersonName(
    command.displayName,
    "displayName",
  );
  const contractStatus = normalizeContractStatus(
    command.contractStatus,
  );

  if (
    contractStatus !== "NONE" &&
    contractStatus !== "PENDING_SIGNATURE" &&
    contractStatus !== "ACTIVE"
  ) {
    throw new EmploymentProfileValidationError(
      "contractStatus must be NONE, PENDING_SIGNATURE, or ACTIVE when creating an employment profile",
    );
  }

  const hiredAt = normalizeOptionalNullableCanonicalCalendarDateValue(
    command.hiredAt,
    "hiredAt",
  );
  const onboardedAt =
    normalizeOptionalNullableCanonicalCalendarDateValue(
      command.onboardedAt,
      "onboardedAt",
    );
  assertBusinessDateOrder(hiredAt, onboardedAt);

  return {
    employeeCode: normalizeOptionalCreateCode(
      command.employeeCode,
      "employeeCode",
    ),
    legalName,
    normalizedLegalName: normalizeNameForSearch(
      legalName,
    ),
    displayName,
    normalizedDisplayName: normalizeNameForSearch(
      displayName,
    ),
    employmentKind: normalizeEmploymentKind(
      command.employmentKind,
    ),
    jobTitle: normalizeDisplayText(
      command.jobTitle,
      "jobTitle",
    ),
    titleDescription: normalizeNullableText(
      command.titleDescription,
      "titleDescription",
    ),
    externalRef: normalizeNullableText(
      command.externalRef,
      "externalRef",
    ),
    orgUnitId: normalizeRequiredText(
      command.orgUnitId,
      "orgUnitId",
    ),
    linkedUserId: normalizeOptionalNullableId(
      command.linkedUserId,
      "linkedUserId",
    ),
    recruiterEmploymentProfileId:
      normalizeOptionalNullableId(
        command.recruiterEmploymentProfileId,
        "recruiterEmploymentProfileId",
      ),
    hrOwnerEmploymentProfileId:
      normalizeOptionalNullableId(
        command.hrOwnerEmploymentProfileId,
        "hrOwnerEmploymentProfileId",
      ),
    onboardingOwnerEmploymentProfileId:
      normalizeOptionalNullableId(
        command.onboardingOwnerEmploymentProfileId,
        "onboardingOwnerEmploymentProfileId",
      ),
    sourcedByEmploymentProfileId:
      normalizeOptionalNullableId(
        command.sourcedByEmploymentProfileId,
        "sourcedByEmploymentProfileId",
      ),
    contractStatus,
    employmentStartDate:
      normalizeCanonicalCalendarDateValue(
        command.employmentStartDate,
        "employmentStartDate",
      ),
    hiredAt,
    onboardedAt,
  };
}

function rejectLegacyManagerField(
  command: object,
  operation: string,
): void {
  if (
    Object.prototype.hasOwnProperty.call(
      command as unknown as Readonly<Record<string, unknown>>,
      "managerEmploymentProfileId",
    )
  ) {
    throw new EmploymentProfileValidationError(
      `managerEmploymentProfileId is not accepted on ${operation}. Use central responsibility assignments for HR reporting manager responsibility.`,
    );
  }
}

function normalizeOptionalCreateCode(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new EmploymentProfileValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();
  return normalized.length > 0
    ? normalized
    : undefined;
}

function buildEmploymentProfileCorePatch(params: {
  readonly current: EmploymentProfileRecord;
  readonly employmentProfileId: string;
  readonly legalName?: string;
  readonly displayName?: string;
  readonly employmentKind?: EmploymentKind;
  readonly jobTitle?: string;
  readonly externalRef?: string | null;
  readonly titleDescription?: string | null;
  readonly recruiterEmploymentProfileId?: string | null;
  readonly hrOwnerEmploymentProfileId?: string | null;
  readonly onboardingOwnerEmploymentProfileId?: string | null;
  readonly sourcedByEmploymentProfileId?: string | null;
  readonly hiredAt?: number | null;
  readonly onboardedAt?: number | null;
}): UpdateEmploymentProfileCoreInput {
  const patch: {
    employmentProfileId: string;
    updatedAt: number;
    legalName?: string;
    normalizedLegalName?: string;
    displayName?: string;
    normalizedDisplayName?: string;
    employmentKind?: EmploymentKind;
    jobTitle?: string;
    externalRef?: string | null;
    titleDescription?: string | null;
    recruiterEmploymentProfileId?: string | null;
    hrOwnerEmploymentProfileId?: string | null;
    onboardingOwnerEmploymentProfileId?: string | null;
    sourcedByEmploymentProfileId?: string | null;
    hiredAt?: number | null;
    onboardedAt?: number | null;
  } = {
    employmentProfileId: params.employmentProfileId,
    updatedAt: Date.now(),
  };

  if (
    params.legalName !== undefined &&
    params.legalName !== params.current.legalName
  ) {
    patch.legalName = params.legalName;
    patch.normalizedLegalName =
      normalizeNameForSearch(params.legalName);
  }

  if (
    params.displayName !== undefined &&
    params.displayName !== params.current.displayName
  ) {
    patch.displayName = params.displayName;
    patch.normalizedDisplayName =
      normalizeNameForSearch(
        params.displayName,
      );
  }

  if (
    params.employmentKind !== undefined &&
    params.employmentKind !==
      params.current.employmentKind
  ) {
    patch.employmentKind = params.employmentKind;
  }

  if (
    params.jobTitle !== undefined &&
    params.jobTitle !== params.current.jobTitle
  ) {
    patch.jobTitle = params.jobTitle;
  }

  if (
    params.externalRef !== undefined &&
    params.externalRef !== params.current.externalRef
  ) {
    patch.externalRef = params.externalRef;
  }

  if (
    params.titleDescription !== undefined &&
    params.titleDescription !==
      params.current.titleDescription
  ) {
    patch.titleDescription =
      params.titleDescription;
  }

  if (
    params.recruiterEmploymentProfileId !== undefined &&
    params.recruiterEmploymentProfileId !==
      params.current.recruiterEmploymentProfileId
  ) {
    patch.recruiterEmploymentProfileId =
      params.recruiterEmploymentProfileId;
  }

  if (
    params.hrOwnerEmploymentProfileId !== undefined &&
    params.hrOwnerEmploymentProfileId !==
      params.current.hrOwnerEmploymentProfileId
  ) {
    patch.hrOwnerEmploymentProfileId =
      params.hrOwnerEmploymentProfileId;
  }

  if (
    params.onboardingOwnerEmploymentProfileId !== undefined &&
    params.onboardingOwnerEmploymentProfileId !==
      params.current.onboardingOwnerEmploymentProfileId
  ) {
    patch.onboardingOwnerEmploymentProfileId =
      params.onboardingOwnerEmploymentProfileId;
  }

  if (
    params.sourcedByEmploymentProfileId !== undefined &&
    params.sourcedByEmploymentProfileId !==
      params.current.sourcedByEmploymentProfileId
  ) {
    patch.sourcedByEmploymentProfileId =
      params.sourcedByEmploymentProfileId;
  }

  if (
    params.hiredAt !== undefined &&
    params.hiredAt !== params.current.hiredAt
  ) {
    patch.hiredAt = params.hiredAt;
  }

  if (
    params.onboardedAt !== undefined &&
    params.onboardedAt !== params.current.onboardedAt
  ) {
    patch.onboardedAt = params.onboardedAt;
  }

  assertBusinessDateOrder(
    patch.hiredAt !== undefined
      ? patch.hiredAt
      : params.current.hiredAt,
    patch.onboardedAt !== undefined
      ? patch.onboardedAt
      : params.current.onboardedAt,
  );

  return patch;
}

function assertContractStatusTransitionAllowed(
  currentStatus: EmploymentContractStatus,
  nextStatus: EmploymentContractStatus,
  employmentStatus: EmploymentStatus,
): void {
  if (
    employmentStatus === "TERMINATED" ||
    employmentStatus === "ARCHIVED"
  ) {
    if (nextStatus !== "TERMINATED") {
      throw new EmploymentProfileStateError(
        `Employment profile in ${employmentStatus} must keep contractStatus TERMINATED`,
      );
    }

    return;
  }

  if (nextStatus === "TERMINATED") {
    throw new EmploymentProfileStateError(
      "contractStatus TERMINATED is allowed only for TERMINATED or ARCHIVED employment profiles",
    );
  }

  const allowedTransitions: Readonly<
    Record<
      EmploymentContractStatus,
      readonly EmploymentContractStatus[]
    >
  > = Object.freeze({
    NONE: [
      "PENDING_SIGNATURE",
      "ACTIVE",
    ],
    PENDING_SIGNATURE: [
      "NONE",
      "ACTIVE",
    ],
    ACTIVE: [
      "EXPIRED",
      "TERMINATED",
    ],
    EXPIRED: [
      "ACTIVE",
      "TERMINATED",
    ],
    TERMINATED: [],
  });

  if (
    allowedTransitions[currentStatus]?.includes(
      nextStatus,
    )
  ) {
    return;
  }

  throw new EmploymentProfileStateError(
    `Contract status cannot transition from ${currentStatus} to ${nextStatus}`,
  );
}

function assertEmploymentProfileRecordInvariant(
  employmentProfile: EmploymentProfileRecord,
): void {
  const status = employmentProfile.employmentStatus;
  const contractStatus =
    employmentProfile.contractStatus;
  const endDate =
    employmentProfile.employmentEndDate;

  if (
    (status === "ACTIVE" ||
      status === "ON_LEAVE" ||
      status === "SUSPENDED") &&
    endDate !== null
  ) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Employment profile ${employmentProfile.id} must not have employmentEndDate in status ${status}`,
    );
  }

  if (
    (status === "TERMINATED" ||
      status === "ARCHIVED") &&
    endDate === null
  ) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Employment profile ${employmentProfile.id} must have employmentEndDate in status ${status}`,
    );
  }

  if (
    contractStatus === "TERMINATED" &&
    status !== "TERMINATED" &&
    status !== "ARCHIVED"
  ) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Employment profile ${employmentProfile.id} has invalid TERMINATED contractStatus for status ${status}`,
    );
  }

  if (
    (status === "TERMINATED" ||
      status === "ARCHIVED") &&
    contractStatus !== "TERMINATED"
  ) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Employment profile ${employmentProfile.id} must keep contractStatus TERMINATED in status ${status}`,
    );
  }
}

function toEmploymentProfileMutationView(
  employmentProfile: EmploymentProfileRecord,
): EmploymentProfileMutationView {
  return {
    id: employmentProfile.id,
    employeeCode: employmentProfile.employeeCode,
    legalName: employmentProfile.legalName,
    displayName: employmentProfile.displayName,
    employmentKind:
      employmentProfile.employmentKind,
    jobTitle: employmentProfile.jobTitle,
    titleDescription:
      employmentProfile.titleDescription,
    externalRef: employmentProfile.externalRef,
    orgUnitId: employmentProfile.orgUnitId,
    recruiterEmploymentProfileId:
      employmentProfile.recruiterEmploymentProfileId,
    hrOwnerEmploymentProfileId:
      employmentProfile.hrOwnerEmploymentProfileId,
    onboardingOwnerEmploymentProfileId:
      employmentProfile.onboardingOwnerEmploymentProfileId,
    sourcedByEmploymentProfileId:
      employmentProfile.sourcedByEmploymentProfileId,
    linkedUserId: employmentProfile.linkedUserId,
    employmentStatus:
      employmentProfile.employmentStatus,
    contractStatus:
      employmentProfile.contractStatus,
    employmentStartDate:
      employmentProfile.employmentStartDate,
    employmentEndDate:
      employmentProfile.employmentEndDate,
    hiredAt: employmentProfile.hiredAt,
    onboardedAt: employmentProfile.onboardedAt,
    createdAt: employmentProfile.createdAt,
    updatedAt: employmentProfile.updatedAt,
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
    throw new EmploymentProfileValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new EmploymentProfileValidationError(
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

function normalizePersonName(
  value: unknown,
  field: string,
): string {
  return normalizeDisplayText(value, field);
}

function normalizeNullableText(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new EmploymentProfileValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");

  if (normalized.length === 0) {
    throw new EmploymentProfileValidationError(
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
    throw new EmploymentProfileValidationError(
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
    throw new EmploymentProfileValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new EmploymentProfileValidationError(
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
    throw new EmploymentProfileValidationError(
      `${field} must be provided`,
    );
  }

  if (typeof value !== "string") {
    throw new EmploymentProfileValidationError(
      `${field} must be a string or null`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new EmploymentProfileValidationError(
      `${field} must not be empty`,
    );
  }

  return normalized;
}

function normalizeOptionalNullableCanonicalCalendarDateValue(
  value: unknown,
  field: string,
): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  return normalizeCanonicalCalendarDateValue(value, field);
}

function normalizeNullableCanonicalCalendarDateValue(
  value: unknown,
  field: string,
): number | null {
  if (value === undefined) {
    throw new EmploymentProfileValidationError(
      `${field} must be provided`,
    );
  }

  if (value === null) {
    return null;
  }

  return normalizeCanonicalCalendarDateValue(value, field);
}

function normalizeEmploymentKind(
  value: unknown,
): EmploymentKind {
  if (typeof value === "string") {
    const normalized = value.trim();

    if (
      EMPLOYMENT_KINDS.includes(
        normalized as EmploymentKind,
      )
    ) {
      return normalized as EmploymentKind;
    }
  }

  throw new EmploymentProfileValidationError(
    `employmentKind must be one of ${EMPLOYMENT_KINDS.join(", ")}`,
  );
}

function normalizeContractStatus(
  value: unknown,
): EmploymentContractStatus {
  if (typeof value === "string") {
    const normalized = value.trim();

    if (
      EMPLOYMENT_CONTRACT_STATUSES.includes(
        normalized as EmploymentContractStatus,
      )
    ) {
      return normalized as EmploymentContractStatus;
    }
  }

  throw new EmploymentProfileValidationError(
    `contractStatus must be one of ${EMPLOYMENT_CONTRACT_STATUSES.join(", ")}`,
  );
}

function assertBusinessDateOrder(
  hiredAt: number | null,
  onboardedAt: number | null,
): void {
  if (
    hiredAt !== null &&
    onboardedAt !== null &&
    onboardedAt < hiredAt
  ) {
    throw new EmploymentProfileValidationError(
      "onboardedAt must not be before hiredAt",
    );
  }
}

function normalizeCanonicalCalendarDateValue(
  value: unknown,
  field: string,
): number {
  let numeric: number;

  if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      throw new EmploymentProfileValidationError(
        `${field} must be a valid date`,
      );
    }

    if (/^\d+$/u.test(trimmed)) {
      numeric = Number(trimmed);
    } else if (
      /^\d{4}-\d{2}-\d{2}$/u.test(trimmed)
    ) {
      numeric = parseCanonicalDateStringToUtcMidnight(
        trimmed,
        field,
      );
    } else {
      throw new EmploymentProfileValidationError(
        `${field} must be a canonical calendar date`,
      );
    }
  } else {
    throw new EmploymentProfileValidationError(
      `${field} must be a valid date`,
    );
  }

  if (
    !Number.isFinite(numeric) ||
    !Number.isSafeInteger(numeric) ||
    numeric < 0
  ) {
    throw new EmploymentProfileValidationError(
      `${field} must be a valid date`,
    );
  }

  const normalizedDate = new Date(numeric);

  if (
    Number.isNaN(normalizedDate.getTime()) ||
    normalizedDate.getUTCHours() !== 0 ||
    normalizedDate.getUTCMinutes() !== 0 ||
    normalizedDate.getUTCSeconds() !== 0 ||
    normalizedDate.getUTCMilliseconds() !== 0
  ) {
    throw new EmploymentProfileValidationError(
      `${field} must be a canonical calendar date`,
    );
  }

  return numeric;
}

function parseCanonicalDateStringToUtcMidnight(
  value: string,
  field: string,
): number {
  const [yearText, monthText, dayText] =
    value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    throw new EmploymentProfileValidationError(
      `${field} must be a canonical calendar date`,
    );
  }

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
    throw new EmploymentProfileValidationError(
      `${field} must be a canonical calendar date`,
    );
  }

  return utcMidnight;
}

function assertCalendarDateNotLaterThanEvaluationTime(
  value: number,
  field: string,
  evaluationTime: number,
): void {
  if (value <= evaluationTime) {
    return;
  }

  throw new EmploymentProfileValidationError(
    `${field} must not be later than the evaluation date`,
  );
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

function classifyEmploymentProfileMutationFailure(
  error: unknown,
): EmploymentProfileFailureClassification {
  if (
    error instanceof EmploymentProfileValidationError
  ) {
    return "validation";
  }

  if (
    error instanceof EmploymentProfileConflictError
  ) {
    return "conflict";
  }

  if (
    error instanceof EmploymentProfileNotFoundError
  ) {
    return "not_found";
  }

  if (
    error instanceof EmploymentProfileStateError
  ) {
    return "state_error";
  }

  if (
    error instanceof EmploymentProfileManagerCycleError
  ) {
    return "manager_cycle";
  }

  if (
    error instanceof
    EmploymentProfileInvalidUserLinkageError
  ) {
    return "invalid_user_linkage";
  }

  if (
    error instanceof
    EmploymentProfileInvalidOrgAssignmentError
  ) {
    return "invalid_org_assignment";
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

function createMissingStructuredAuthority(): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService({
    async listByUserId(): Promise<never> {
      throw new EmploymentProfilePermissionScopeError(
        "Structured EmploymentProfile authority is unavailable",
      );
    },
  });
}
