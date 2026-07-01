import crypto from "crypto";
import { ClientSession, Collection, Db } from "mongodb";
import {
  buildWorkspaceAvailability,
} from "@modules/account-context/account-context.workspace-availability";
import {
  AccountContext,
  normalizeAccountContexts,
} from "@modules/account-context/domain/account-context.types";
import {
  buildRoleAssignmentScopeFingerprint,
  normalizeRoleAssignmentScopeGrants,
  RoleAssignmentScopeGrant,
} from "@modules/role/domain/role-assignment-scope";
import {
  classifySensitiveAccess,
  validateSensitiveAccessLifecycle,
} from "@modules/role/domain/sensitive-access-policy";
import { isRoleAssignmentCurrentlyEffective } from "@modules/role/domain/role-assignment-lifecycle";
import { getRoleBundle, listRoleBundles } from "@modules/role/domain/role-bundle.catalog";
import {
  getRoleTemplate,
  listRoleTemplates,
  normalizeRoleTemplateCode,
} from "@modules/role/domain/role-template.catalog";
import { RoleValidationError } from "@modules/role/domain/role.errors";
import { UserRoleAssignmentRecord } from "@modules/role/domain/role.types";

export type AccessAssignmentTargetType = "ROLE" | "ROLE_TEMPLATE" | "BUNDLE";

export interface AccessAssignmentPreviewCommand {
  /**
   * Internal controller-supplied actor id. This is not an HTTP request field.
   */
  readonly actorUserId?: string;
  readonly targetUserId: string;
  readonly assignmentTargetType: AccessAssignmentTargetType;
  readonly assignmentTargetId?: string;
  readonly assignmentTargetCode?: string;
  readonly bundleVersion?: string;
  readonly structuredScopeGrants?: readonly RoleAssignmentScopeGrant[];
  readonly reason?: string | null;
  readonly effectiveAt?: number | string | null;
  readonly expiresAt?: number | string | null;
  readonly reviewAt?: number | string | null;
  readonly sourceContext?: AccessAssignmentSourceContext;
}

export interface AccessAssignmentSourceContext {
  readonly talentGroupId?: string;
  readonly orgUnitId?: string;
  readonly platformAccountId?: string;
  readonly eventId?: string;
  readonly studioResourceId?: string;
  readonly financePeriod?: string;
  readonly payrollPeriod?: string;
  readonly attendancePeriodOrgUnitId?: string;
}

interface UserDocument {
  readonly _id: string;
  readonly actorKind: "ADMIN" | "STAFF";
  readonly accountStatus: string;
  readonly accountContexts?: readonly AccountContext[];
  readonly disabledAt?: number | null;
  readonly archivedAt?: number | null;
  readonly profile?: { readonly displayName?: string; readonly email?: string };
}

interface EmploymentProfileDocument {
  readonly _id: string;
  readonly employeeCode: string;
  readonly displayName: string;
  readonly employmentStatus: string;
  readonly linkedUserId?: string | null;
}

interface RoleDocument {
  readonly _id: string;
  readonly code: string;
  readonly name: string;
  readonly state: string;
  readonly permissions: readonly string[];
  readonly templateCode?: string;
}

interface AssignmentDocument {
  readonly _id: string;
  readonly roleId: string;
  readonly userId: string;
  readonly structuredScopeGrants?: readonly RoleAssignmentScopeGrant[];
  readonly scopeFingerprint?: string;
  readonly state: "ACTIVE" | "REVOKED";
  readonly effectiveAt: number | null;
  readonly expiresAt?: number | null;
  readonly reviewAt?: number | null;
  readonly assignedBy?: string | null;
  readonly assignedAt?: number;
  readonly origin?: "DIRECT" | "BUNDLE" | "LEGACY";
  readonly bundleOrigin?: UserRoleAssignmentRecord["bundleOrigin"];
  readonly reason: string | null;
  readonly createdAt: number;
}

interface ResponsibilityDocument {
  readonly _id: string;
  readonly subjectType: "TALENT_GROUP" | "ORG_UNIT" | string;
  readonly subjectId: string;
  readonly responsibleEmploymentProfileId: string;
  readonly responsibilityType: "TALENT_GROUP_MANAGER" | "ORG_UNIT_MANAGER" | string;
  readonly status: string;
  readonly effectiveAt: number;
  readonly expiresAt: number | null;
}

interface ProposedAssignment {
  readonly assignmentId: string;
  readonly roleId: string;
  readonly roleCode: string;
  readonly roleName: string;
  readonly permissions: readonly string[];
  readonly structuredScopeGrants: readonly RoleAssignmentScopeGrant[];
  readonly scopeFingerprint: string;
  readonly effectiveAt: number;
  readonly expiresAt: number | null;
  readonly reviewAt: number | null;
  readonly origin: "DIRECT" | "BUNDLE";
  readonly bundleOrigin: UserRoleAssignmentRecord["bundleOrigin"];
  readonly reason: string | null;
}

const LEGACY_ASSIGNMENT_TARGET_CODES = new Set([
  "ADMIN_FULL",
  "TEAM_MANAGER",
  "COMMERCIAL_FINANCE",
  "TALENT_STAFF_SELF",
]);

const MANAGER_REQUIREMENTS = {
  TALENT_GROUP_MANAGER: {
    scopeType: "managedTalentGroup",
    subjectType: "TALENT_GROUP",
    responsibilityType: "TALENT_GROUP_MANAGER",
  },
  ORG_UNIT_MANAGER: {
    scopeType: "managedOrgUnit",
    subjectType: "ORG_UNIT",
    responsibilityType: "ORG_UNIT_MANAGER",
  },
} as const;

export class AccessAssignmentPreviewAdminService {
  private readonly users: Collection<UserDocument>;
  private readonly employmentProfiles: Collection<EmploymentProfileDocument>;
  private readonly roles: Collection<RoleDocument>;
  private readonly assignments: Collection<AssignmentDocument>;
  private readonly responsibilities: Collection<ResponsibilityDocument>;

  constructor(private readonly db: Db) {
    this.users = db.collection<UserDocument>("users");
    this.employmentProfiles =
      db.collection<EmploymentProfileDocument>("employment_profiles");
    this.roles = db.collection<RoleDocument>("roles");
    this.assignments = db.collection<AssignmentDocument>("role_assignments");
    this.responsibilities =
      db.collection<ResponsibilityDocument>("responsibility_assignments");
  }

  listTargetOptions(): Record<string, unknown> {
    return {
      readOnly: true,
      unrestrictedUserListReturned: false,
      searchFirstUserPickerRequired: true,
      eligibleUsersReturned: false,
      userListReturned: false,
      frontendSettableFields: [
        "targetUserId",
        "assignmentTargetType",
        "assignmentTargetId",
        "assignmentTargetCode",
        "bundleVersion",
        "structuredScopeGrants",
        "reason",
        "effectiveAt",
        "expiresAt",
        "reviewAt",
        "sourceContext",
      ],
      frontendSettableAuthorityFields: [],
      backendOwnedAuthorityFields: [
        "accountContext",
        "accountContexts",
        "console",
        "consoleCode",
        "workspaceAvailability",
        "primaryWorkspace",
        "actorKind",
        "manualConsoleEntitlement",
        "consoleEntitlement",
        "entitlements",
      ],
      assignmentTargets: [
        ...listRoleTemplates().map((template) => ({
          assignmentKind: "ROLE_TEMPLATE",
          code: template.code,
          name: template.name,
          recommendedAccountContext: template.recommendedAccountContext,
          requiredScopeTypes: template.scopePlan.flatMap((entry) => entry.scopes),
          requiresResponsibility: isManagerRoleCode(template.code),
          requiredResponsibilityType: requiredResponsibilityTypeForRole(template.code),
          sensitiveLevel: classifySensitiveAccess([
            {
              roleCode: template.code,
              roleTemplateCode: template.code,
              permissions: getRoleTemplate(template.code)?.permissions ?? [],
            },
          ]).isHighRisk
            ? "HIGH_RISK"
            : "STANDARD",
          legacyAssignable: !LEGACY_ASSIGNMENT_TARGET_CODES.has(template.code),
          recommendedPickerMode: isManagerRoleCode(template.code)
            ? "RESPONSIBILITY_SCOPE_FIRST"
            : "SEARCH_FIRST",
        })),
        ...listRoleBundles().map((bundle) => ({
          assignmentKind: "BUNDLE",
          code: bundle.code,
          version: bundle.version,
          name: bundle.name,
          childRoles: bundle.childRoles,
          recommendedAccountContext: bundle.recommendedAccountContext,
          requiredScopeTypes: bundle.recommendedScopes,
          requiresResponsibility: bundle.childRoles.some(isManagerRoleCode),
          requiredResponsibilityType:
            bundle.childRoles.map(requiredResponsibilityTypeForRole).filter(Boolean),
          sensitiveLevel: bundle.sensitive ? "HIGH_RISK" : "STANDARD",
          legacyAssignable: !bundle.childRoles.some((code) =>
            LEGACY_ASSIGNMENT_TARGET_CODES.has(code),
          ),
          recommendedPickerMode: bundle.childRoles.some(isManagerRoleCode)
            ? "RESPONSIBILITY_SCOPE_FIRST"
            : "SEARCH_FIRST",
        })),
      ],
      previewRemainsAuthoritative: true,
    };
  }

  async preview(
    command: AccessAssignmentPreviewCommand,
    options?: { readonly session?: ClientSession },
  ): Promise<Record<string, unknown>> {
    const now = Date.now();
    const targetUserId = normalizeRequiredText(command.targetUserId, "targetUserId");
    const reason = normalizeNullableText(command.reason, "reason");
    const structuredScopeGrants =
      normalizeRoleAssignmentScopeGrants(command.structuredScopeGrants) ?? [];
    const scopeFingerprint =
      buildRoleAssignmentScopeFingerprint(structuredScopeGrants);
    const effectiveAt =
      normalizeOptionalTimestamp(command.effectiveAt, "effectiveAt") ?? now;
    const expiresAt = normalizeOptionalTimestamp(command.expiresAt, "expiresAt");
    const reviewAt = normalizeOptionalTimestamp(command.reviewAt, "reviewAt");
    assertAssignmentDates(effectiveAt, expiresAt, reviewAt);

    const blockers: Array<Record<string, unknown>> = [];
    const warnings: Array<Record<string, unknown>> = [];
    const completenessGaps: Array<Record<string, unknown>> = [];

    const [targetUser, employmentProfile] = await Promise.all([
      this.readAssignableUser(targetUserId, options?.session),
      this.readActiveEmploymentProfileForUser(targetUserId, options?.session),
    ]);

    if (!targetUser) {
      blockers.push(blocker("TARGET_USER_NOT_ASSIGNABLE", "Target user is not active or assignable."));
    }

    const targetResolution = await this.resolveAssignmentTarget(
      command,
      blockers,
      options?.session,
    );
    const proposedAssignments = targetResolution.roles.map((role) => ({
      assignmentId: `preview:${crypto.randomUUID()}`,
      roleId: role._id,
      roleCode: role.code,
      roleName: role.name,
      permissions: role.permissions,
      structuredScopeGrants,
      scopeFingerprint,
      effectiveAt,
      expiresAt,
      reviewAt,
      origin: targetResolution.bundleOrigin ? ("BUNDLE" as const) : ("DIRECT" as const),
      bundleOrigin: targetResolution.bundleOrigin,
      reason,
    }));

    if (targetUserId === commandSourceActorId(command)) {
      blockers.push(blocker("SELF_ASSIGNMENT_BLOCKED", "Current actor cannot assign access to themselves."));
    }

    const sensitiveAccess = buildSensitiveAccessView({
      assignments: proposedAssignments,
      catalogSensitive: targetResolution.sensitive,
      effectiveAt,
      reviewAt,
      expiresAt,
    });
    if (sensitiveAccess.reasonRequired && !reason) {
      blockers.push(blocker("REASON_REQUIRED", "Reason is required for sensitive or global access."));
    }
    for (const lifecycleBlocker of sensitiveAccess.lifecycleBlockers) {
      blockers.push(blocker(lifecycleBlocker.code, lifecycleBlocker.summary));
    }
    if (sensitiveAccess.sensitiveOrGlobal) {
      warnings.push(warning("ADDITIONAL_REVIEW_REQUIRED", "Additional review is required for sensitive or global access."));
    }

    const duplicateConflicts = await this.findDuplicateConflicts(
      proposedAssignments,
      targetUserId,
      options?.session,
    );
    if (duplicateConflicts.length > 0) {
      blockers.push(blocker("DUPLICATE_ACTIVE_ASSIGNMENT", "An active assignment already exists for the exact role, user, and scope."));
    }

    const responsibilityRequirements = await this.evaluateResponsibilityRequirements({
      employmentProfile,
      proposedAssignments,
      structuredScopeGrants,
      now,
      session: options?.session,
    });
    for (const requirement of responsibilityRequirements) {
      if (requirement.status !== "SATISFIED") {
        blockers.push(blocker("RESPONSIBILITY_REQUIRED", "Matching active management responsibility is required."));
      }
    }

    const accountContextRequirement = buildAccountContextRequirement({
      currentAccountContexts: targetUser?.accountContexts ?? [],
      requiredAccountContexts: targetResolution.requiredAccountContexts,
      targetUserResolved: !!targetUser,
    });
    const missingRequiredAccountContexts =
      accountContextRequirement.missingAccountContexts;

    if (targetUser && missingRequiredAccountContexts.length > 0) {
      blockers.push(
        blocker(
          "REQUIRED_ACCOUNT_CONTEXT_MISSING",
          "Target user is missing required AccountContext for the selected assignment target; preview does not mutate AccountContext.",
        ),
      );
      warnings.push(
        warning(
          "ACCOUNT_CONTEXT_NOT_MUTATED_IN_PREVIEW",
          "AccountContext materialization is not in scope for this preview.",
        ),
      );
      completenessGaps.push({
        code: "ACCOUNT_CONTEXT_MATERIALIZATION_DEFERRED",
        summary:
          "Required AccountContext is missing and cannot be materialized by the 4A preview contract.",
        materializationInScope: false,
        missingAccountContexts: missingRequiredAccountContexts,
      });
    }

    const currentEffectiveAccess = targetUser
      ? await this.computeEffectiveAccess(targetUser, [], options?.session)
      : null;
    const proposedEffectiveAccess = targetUser
      ? await this.computeEffectiveAccess(
          targetUser,
          proposedAssignments,
          options?.session,
        )
      : null;

    if (!currentEffectiveAccess || !proposedEffectiveAccess) {
      completenessGaps.push({
        code: "EFFECTIVE_ACCESS_PARTIAL",
        summary: "Effective-access delta is partial because the target user could not be resolved.",
      });
    }

    const consoleEntitlementPreview = buildConsoleEntitlementPreview({
      currentAccountContexts: targetUser?.accountContexts ?? [],
      proposedContexts: targetResolution.requiredAccountContexts,
      missingRequiredAccountContexts,
      responsibilityRequirements,
      blockers,
    });

    return {
      previewOnly: true,
      canApply: blockers.length === 0,
      blockers,
      warnings,
      targetUser: targetUser
        ? {
            id: targetUser._id,
            displayName: targetUser.profile?.displayName ?? null,
            email: targetUser.profile?.email ?? null,
            accountStatus: targetUser.accountStatus,
            activeEmploymentProfile: employmentProfile
              ? {
                  id: employmentProfile._id,
                  employeeCode: employmentProfile.employeeCode,
                  displayName: employmentProfile.displayName,
                  employmentStatus: employmentProfile.employmentStatus,
                }
              : null,
          }
        : { id: targetUserId, missing: true },
      assignmentTarget: targetResolution.assignmentTarget,
      requestedScope: command.structuredScopeGrants ?? [],
      normalizedScope: structuredScopeGrants,
      scopeFingerprint,
      reasonRequirement: {
        required: sensitiveAccess.reasonRequired,
        satisfied: !sensitiveAccess.reasonRequired || !!reason,
        codes: sensitiveAccess.reasonRequired ? ["SENSITIVE_OR_GLOBAL_REASON_REQUIRED"] : [],
      },
      lifecyclePreview: {
        effectiveAt,
        expiresAt,
        reviewAt,
        currentlyEffectiveAtPreviewTime:
          effectiveAt <= now && (expiresAt === null || expiresAt >= now),
      },
      currentEffectiveAccess,
      proposedEffectiveAccess,
      effectiveAccessDelta: buildEffectiveAccessDelta(
        currentEffectiveAccess,
        proposedEffectiveAccess,
      ),
      proposedAssignments,
      bundleExpansion: targetResolution.bundleExpansion,
      accountContextRequirement,
      consoleEntitlementPreview,
      responsibilityRequirements,
      sensitiveAccess,
      duplicateConflicts,
      legacyRoleStatus: targetResolution.legacyRoleStatus,
      selfAssignmentStatus: {
        actorUserId: commandSourceActorId(command),
        targetUserId,
        blocked: targetUserId === commandSourceActorId(command),
      },
      previewCompleteness: {
        status: completenessGaps.length === 0 ? "COMPLETE" : "PARTIAL",
        gaps: completenessGaps,
        deferredCapabilities: [
          {
            code: "PICKER_OPTIONS_METADATA_ONLY",
            summary:
              "/targets returns assignment target metadata only; eligible-user and eligible-scope pickers are deferred.",
          },
          ...(missingRequiredAccountContexts.length > 0
            ? [
                {
                  code: "ACCOUNT_CONTEXT_MATERIALIZATION_DEFERRED",
                  summary:
                    "AccountContext materialization is deferred outside 4A preview.",
                },
              ]
            : []),
        ],
        beforeAfterEffectiveAccess: currentEffectiveAccess && proposedEffectiveAccess
          ? "SUPPORTED_IN_MEMORY"
          : "PARTIAL",
        pickerOptions: "TARGET_METADATA_ONLY",
        accountContextMaterialization:
          missingRequiredAccountContexts.length > 0 ? "DEFERRED_OUT_OF_SCOPE" : "NOT_REQUIRED",
      },
      sourceTrace: {
        roleSource: "roles",
        assignmentSource: "role_assignments",
        bundleSource: targetResolution.bundleExpansion ? "role-bundle.catalog" : null,
        accountContextSource: "users.accountContexts",
        responsibilitySource: "responsibility_assignments",
        mutatesSource: false,
      },
    };
  }

  private async resolveAssignmentTarget(
    command: AccessAssignmentPreviewCommand,
    blockers: Array<Record<string, unknown>>,
    session?: ClientSession,
  ): Promise<{
    readonly roles: readonly RoleDocument[];
    readonly assignmentTarget: Record<string, unknown>;
    readonly bundleOrigin: UserRoleAssignmentRecord["bundleOrigin"];
    readonly bundleExpansion: Record<string, unknown> | null;
    readonly sensitive: boolean;
    readonly requiredAccountContexts: readonly AccountContext[];
    readonly legacyRoleStatus: Record<string, unknown>;
  }> {
    const targetType = command.assignmentTargetType;
    if (!["ROLE", "ROLE_TEMPLATE", "BUNDLE"].includes(targetType)) {
      throw new RoleValidationError("assignmentTargetType must be ROLE, ROLE_TEMPLATE, or BUNDLE");
    }

    if (targetType === "BUNDLE") {
      const bundleCode = normalizeRequiredText(command.assignmentTargetCode, "assignmentTargetCode");
      const normalizedBundleCode = normalizeRoleTemplateCode(bundleCode);
      const bundle = getRoleBundle(normalizedBundleCode, command.bundleVersion);
      if (!bundle || bundle.status !== "ACTIVE") {
        blockers.push(blocker("BUNDLE_NOT_FOUND", "Bundle target is unknown or inactive."));
        return emptyTarget(targetType, normalizedBundleCode);
      }
      const bundleAssignmentId = `preview:${crypto.randomUUID()}`;
      const childRoles: RoleDocument[] = [];
      for (const childCode of bundle.childRoles) {
        if (LEGACY_ASSIGNMENT_TARGET_CODES.has(childCode)) {
          blockers.push(blocker("LEGACY_ROLE_BLOCKED", `Legacy role target is blocked: ${childCode}.`));
          continue;
        }
        const role = await this.findActiveRoleByCode(childCode, session);
        if (!role) {
          blockers.push(blocker("BUNDLE_CHILD_ROLE_NOT_ACTIVE", `Bundle child role must exist and be ACTIVE: ${childCode}.`));
          continue;
        }
        childRoles.push(role);
      }
      const bundleOrigin = {
        bundleAssignmentId,
        bundleCode: bundle.code,
        bundleVersion: bundle.version,
      };
      return {
        roles: childRoles,
        assignmentTarget: {
          type: "BUNDLE",
          code: bundle.code,
          version: bundle.version,
          name: bundle.name,
        },
        bundleOrigin,
        bundleExpansion: {
          bundleAssignmentId,
          childRoleCodes: bundle.childRoles,
          proposedChildCount: childRoles.length,
          persistedParentBundleAssignment: false,
        },
        sensitive: bundle.sensitive,
        requiredAccountContexts: [bundle.recommendedAccountContext],
        legacyRoleStatus: {
          checked: true,
          blockedCodes: bundle.childRoles.filter((code) =>
            LEGACY_ASSIGNMENT_TARGET_CODES.has(code),
          ),
        },
      };
    }

    const role =
      targetType === "ROLE"
        ? await this.findRoleByIdOrCode(
            command.assignmentTargetId,
            command.assignmentTargetCode,
            session,
          )
        : await this.findActiveRoleByCode(
            normalizeRequiredText(command.assignmentTargetCode, "assignmentTargetCode"),
            session,
          );
    const requestedCode = normalizeRoleTemplateCode(
      command.assignmentTargetCode ?? role?.code ?? "",
    );
    const legacyBlockedCodes = new Set<string>();

    if (requestedCode && LEGACY_ASSIGNMENT_TARGET_CODES.has(requestedCode)) {
      legacyBlockedCodes.add(requestedCode);
    }
    if (!role) {
      blockers.push(blocker("ROLE_NOT_FOUND", "Role target is unknown or inactive."));
      return emptyTarget(targetType, requestedCode);
    }
    if (role.state !== "ACTIVE") {
      blockers.push(blocker("ROLE_NOT_ACTIVE", "Role target must be ACTIVE."));
    }
    const roleCodes = [role.code, role.templateCode].filter(
      (value): value is string => typeof value === "string",
    );
    for (const code of roleCodes) {
      const normalized = normalizeRoleTemplateCode(code);
      if (LEGACY_ASSIGNMENT_TARGET_CODES.has(normalized)) {
        legacyBlockedCodes.add(normalized);
      }
    }
    for (const code of [...legacyBlockedCodes].sort()) {
      blockers.push(blocker("LEGACY_ROLE_BLOCKED", `Legacy role target is blocked: ${code}.`));
    }
    const governingCode = role.templateCode ?? role.code;
    const template = getRoleTemplate(governingCode);
    return {
      roles: [role],
      assignmentTarget: {
        type: targetType,
        id: role._id,
        code: role.code,
        templateCode: role.templateCode ?? null,
        name: role.name,
      },
      bundleOrigin: null,
      bundleExpansion: null,
      sensitive: classifySensitiveAccess([
        {
          roleCode: role.code,
          roleTemplateCode: governingCode,
          permissions: role.permissions,
        },
      ]).isSensitive,
      requiredAccountContexts: template ? [template.recommendedAccountContext] : [],
      legacyRoleStatus: {
        checked: true,
        blockedCodes: roleCodes.filter((code) =>
          LEGACY_ASSIGNMENT_TARGET_CODES.has(normalizeRoleTemplateCode(code)),
        ),
      },
    };
  }

  private async findRoleByIdOrCode(
    roleId: string | undefined,
    roleCode: string | undefined,
    session?: ClientSession,
  ): Promise<RoleDocument | null> {
    if (roleId) {
      return this.roles.findOne({ _id: roleId }, mongoOptions(session));
    }
    return this.findActiveRoleByCode(
      normalizeRequiredText(roleCode, "assignmentTargetCode"),
      session,
    );
  }

  private async findActiveRoleByCode(
    code: string,
    session?: ClientSession,
  ): Promise<RoleDocument | null> {
    const normalized = normalizeRoleTemplateCode(code);
    return this.roles.findOne({
      state: "ACTIVE",
      $or: [{ code: normalized }, { templateCode: normalized }],
    }, mongoOptions(session));
  }

  private async readAssignableUser(
    userId: string,
    session?: ClientSession,
  ): Promise<UserDocument | null> {
    return this.users.findOne({
      _id: userId,
      accountStatus: "ACTIVE",
      disabledAt: null,
      archivedAt: null,
    }, mongoOptions(session));
  }

  private async readActiveEmploymentProfileForUser(
    userId: string,
    session?: ClientSession,
  ): Promise<EmploymentProfileDocument | null> {
    return this.employmentProfiles.findOne({
      linkedUserId: userId,
      employmentStatus: { $in: ["ACTIVE", "ON_LEAVE"] },
    }, mongoOptions(session));
  }

  private async findDuplicateConflicts(
    proposedAssignments: readonly ProposedAssignment[],
    userId: string,
    session?: ClientSession,
  ): Promise<readonly Record<string, unknown>[]> {
    const conflicts: Array<Record<string, unknown>> = [];
    for (const assignment of proposedAssignments) {
      const existing = await this.assignments.findOne({
        roleId: assignment.roleId,
        userId,
        scopeFingerprint: assignment.scopeFingerprint,
        state: "ACTIVE",
      }, mongoOptions(session));
      if (existing) {
        conflicts.push({
          assignmentId: existing._id,
          roleId: assignment.roleId,
          roleCode: assignment.roleCode,
          scopeFingerprint: assignment.scopeFingerprint,
          lifecycleState: "ACTIVE",
        });
      }
    }
    return conflicts;
  }

  private async evaluateResponsibilityRequirements(params: {
    readonly employmentProfile: EmploymentProfileDocument | null;
    readonly proposedAssignments: readonly ProposedAssignment[];
    readonly structuredScopeGrants: readonly RoleAssignmentScopeGrant[];
    readonly now: number;
    readonly session?: ClientSession;
  }): Promise<readonly Record<string, unknown>[]> {
    const requirements: Array<Record<string, unknown>> = [];
    for (const assignment of params.proposedAssignments) {
      const requirement = requirementForRole(assignment.roleCode);
      if (!requirement) {
        continue;
      }
      const matchingScopes = params.structuredScopeGrants.filter(
        (grant) => grant.scopeType === requirement.scopeType,
      );
      if (matchingScopes.length === 0) {
        requirements.push({
          roleCode: assignment.roleCode,
          requiredScopeType: requirement.scopeType,
          requiredResponsibilityType: requirement.responsibilityType,
          status: "MISSING_SCOPE",
        });
        continue;
      }
      if (!params.employmentProfile) {
        requirements.push({
          roleCode: assignment.roleCode,
          requiredScopeType: requirement.scopeType,
          requiredResponsibilityType: requirement.responsibilityType,
          status: "MISSING_ACTIVE_EMPLOYMENT_PROFILE",
        });
        continue;
      }
      for (const scope of matchingScopes) {
        const responsibility = await this.responsibilities.findOne({
          subjectType: requirement.subjectType,
          subjectId: scope.targetId,
          responsibleEmploymentProfileId: params.employmentProfile._id,
          responsibilityType: requirement.responsibilityType,
          status: "ACTIVE",
          effectiveAt: { $lte: params.now },
          $or: [{ expiresAt: null }, { expiresAt: { $gte: params.now } }],
        }, mongoOptions(params.session));
        requirements.push({
          roleCode: assignment.roleCode,
          scopeType: scope.scopeType,
          targetId: scope.targetId,
          requiredResponsibilityType: requirement.responsibilityType,
          requiredSubjectType: requirement.subjectType,
          employmentProfileId: params.employmentProfile._id,
          status: responsibility ? "SATISFIED" : "MISSING_RESPONSIBILITY",
          responsibilityAssignmentId: responsibility?._id ?? null,
        });
      }
    }
    return requirements;
  }

  private async computeEffectiveAccess(
    user: UserDocument,
    proposedAssignments: readonly ProposedAssignment[],
    session?: ClientSession,
  ): Promise<Record<string, unknown>> {
    const now = Date.now();
    const currentAssignments = await this.assignments
      .find({ userId: user._id, state: "ACTIVE" }, mongoOptions(session))
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
    const activeCurrentAssignments = currentAssignments.filter((assignment) =>
      isRoleAssignmentCurrentlyEffective(assignment, now),
    );
    const activeProposedAssignments = proposedAssignments.filter((assignment) =>
      assignment.effectiveAt <= now &&
      (assignment.expiresAt === null || assignment.expiresAt >= now),
    );
    const roleIds = [
      ...new Set([
        ...activeCurrentAssignments.map((item) => item.roleId),
        ...activeProposedAssignments.map((item) => item.roleId),
      ]),
    ];
    const roles = roleIds.length
      ? await this.roles
          .find({ _id: { $in: roleIds }, state: "ACTIVE" }, mongoOptions(session))
          .sort({ code: 1, _id: 1 })
          .toArray()
      : [];
    const roleById = new Map(roles.map((role) => [role._id, role]));
    const permissionSources = new Map<string, Array<Record<string, unknown>>>();
    const assignments = [
      ...activeCurrentAssignments.map((assignment) =>
        assignmentToEffectiveAccessItem(assignment, roleById.get(assignment.roleId)),
      ),
      ...activeProposedAssignments.map(proposedAssignmentToEffectiveAccessItem),
    ].filter((item) => item !== null);

    for (const item of assignments) {
      for (const permission of item.permissions as readonly string[]) {
        const sources = permissionSources.get(permission) ?? [];
        sources.push({
          assignmentId: item.assignmentId,
          roleId: item.roleId,
          roleCode: item.roleCode,
          scopeFingerprint: item.scopeFingerprint,
          structuredScopeGrants: item.structuredScopeGrants,
          origin: item.origin,
          bundleOrigin: item.bundleOrigin,
          previewProposed: item.previewProposed,
        });
        permissionSources.set(permission, sources);
      }
    }
    const accountContexts = normalizeAccountContexts(user.accountContexts);
    return {
      readOnly: true,
      previewComputedInMemory: proposedAssignments.length > 0,
      user: {
        id: user._id,
        displayName: user.profile?.displayName ?? null,
        email: user.profile?.email ?? null,
        accountStatus: user.accountStatus,
      },
      workspaceAvailability: buildWorkspaceAvailability({
        accountContexts,
        effectiveAccessTraceAvailable: true,
        legacyActorKind: user.actorKind,
      }),
      activeRoleAssignments: assignments,
      permissions: [...permissionSources.keys()].sort(),
      permissionSourceTrace: [...permissionSources.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([permission, sources]) => ({ permission, sources })),
      generatedAt: new Date(now).toISOString(),
    };
  }
}

function emptyTarget(targetType: string, code: string): ReturnType<AccessAssignmentPreviewAdminService["resolveAssignmentTarget"]> extends Promise<infer T> ? T : never {
  return {
    roles: [],
    assignmentTarget: { type: targetType, code },
    bundleOrigin: null,
    bundleExpansion: null,
    sensitive: false,
    requiredAccountContexts: [],
    legacyRoleStatus: { checked: true, blockedCodes: [] },
  };
}

function mongoOptions(
  session: ClientSession | undefined,
): { readonly session?: ClientSession } | undefined {
  return session ? { session } : undefined;
}

function assignmentToEffectiveAccessItem(
  assignment: AssignmentDocument,
  role: RoleDocument | undefined,
): Record<string, unknown> | null {
  if (!role) {
    return null;
  }
  const accessRisk = classifySensitiveAccess([
    {
      roleCode: role.code,
      roleTemplateCode: role.templateCode ?? role.code,
      permissions: role.permissions,
      structuredScopeGrants: assignment.structuredScopeGrants ?? [],
      bundleCode: assignment.bundleOrigin?.bundleCode ?? null,
    },
  ]);
  return {
    assignmentId: assignment._id,
    roleId: assignment.roleId,
    roleCode: role.code,
    roleName: role.name,
    permissions: role.permissions,
    structuredScopeGrants: assignment.structuredScopeGrants ?? [],
    scopeFingerprint:
      assignment.scopeFingerprint ?? buildRoleAssignmentScopeFingerprint(undefined),
    reason: assignment.reason,
    effectiveAt: assignment.effectiveAt,
    expiresAt: assignment.expiresAt ?? null,
    reviewAt: assignment.reviewAt ?? null,
    origin: assignment.origin ?? "LEGACY",
    bundleOrigin: assignment.bundleOrigin ?? null,
    previewProposed: false,
    accessRisk,
    isSensitive: accessRisk.isSensitive,
    isGlobalLike: accessRisk.isGlobalLike,
    isHighRisk: accessRisk.isHighRisk,
    requiresReview: accessRisk.requiresReview,
    isBreakGlassLike: accessRisk.isBreakGlassLike,
  };
}

function proposedAssignmentToEffectiveAccessItem(
  assignment: ProposedAssignment,
): Record<string, unknown> {
  const accessRisk = classifySensitiveAccess([
    {
      roleCode: assignment.roleCode,
      permissions: assignment.permissions,
      structuredScopeGrants: assignment.structuredScopeGrants,
      bundleCode: assignment.bundleOrigin?.bundleCode ?? null,
    },
  ]);
  return {
    assignmentId: assignment.assignmentId,
    roleId: assignment.roleId,
    roleCode: assignment.roleCode,
    roleName: assignment.roleName,
    permissions: assignment.permissions,
    structuredScopeGrants: assignment.structuredScopeGrants,
    scopeFingerprint: assignment.scopeFingerprint,
    reason: assignment.reason,
    effectiveAt: assignment.effectiveAt,
    expiresAt: assignment.expiresAt,
    reviewAt: assignment.reviewAt,
    origin: assignment.origin,
    bundleOrigin: assignment.bundleOrigin,
    previewProposed: true,
    accessRisk,
    isSensitive: accessRisk.isSensitive,
    isGlobalLike: accessRisk.isGlobalLike,
    isHighRisk: accessRisk.isHighRisk,
    requiresReview: accessRisk.requiresReview,
    isBreakGlassLike: accessRisk.isBreakGlassLike,
  };
}

function buildSensitiveAccessView(params: {
  readonly assignments: readonly ProposedAssignment[];
  readonly catalogSensitive: boolean;
  readonly effectiveAt: number;
  readonly reviewAt: number | null;
  readonly expiresAt: number | null;
}): Record<string, unknown> & {
  readonly sensitiveOrGlobal: boolean;
  readonly reasonRequired: boolean;
  readonly lifecycleBlockers: readonly { readonly code: string; readonly summary: string }[];
} {
  const classification = classifySensitiveAccess(params.assignments, {
    catalogSensitive: params.catalogSensitive,
  });
  const lifecycleValidation = validateSensitiveAccessLifecycle(classification, {
    effectiveAt: params.effectiveAt,
    reviewAt: params.reviewAt,
    expiresAt: params.expiresAt,
  });
  const sensitiveOrGlobal = classification.isSensitive || classification.isGlobalLike;
  return {
    sensitiveOrGlobal,
    isSensitive: classification.isSensitive,
    isGlobalLike: classification.isGlobalLike,
    isHighRisk: classification.isHighRisk,
    requiresReview: classification.requiresReview,
    reasonRequired: classification.requiresReason,
    requiresExpiry: classification.requiresExpiry,
    isBreakGlassLike: classification.isBreakGlassLike,
    isPrivilegedAccessGovernance: classification.isPrivilegedAccessGovernance,
    reviewAt: params.reviewAt,
    expiresAt: params.expiresAt,
    maxReviewWindowDays: classification.maxReviewWindowDays,
    maxExpiryWindowDays: classification.maxExpiryWindowDays,
    globalScopes: classification.globalScopes,
    highRiskRoleCodes: classification.highRiskRoleCodes,
    sensitiveRoleCodes: classification.sensitiveRoleCodes,
    sensitivePermissions: classification.sensitivePermissions,
    riskReasons: classification.riskReasons,
    lifecycleBlockers: lifecycleValidation.blockers,
    denyReasons: lifecycleValidation.blockers.map((item) => item.code),
    reviewPolicy: classification.requiresReview
      ? "REVIEW_REQUIRED"
      : "NOT_REQUIRED",
    approvalWorkflow: "NOT_IMPLEMENTED_IN_AUTH_5A",
  };
}

function buildAccountContextRequirement(params: {
  readonly currentAccountContexts: readonly AccountContext[];
  readonly requiredAccountContexts: readonly AccountContext[];
  readonly targetUserResolved: boolean;
}): {
  readonly status:
    | "NOT_REQUIRED"
    | "SATISFIED"
    | "MISSING_REQUIRED_CONTEXT"
    | "TARGET_USER_UNRESOLVED";
  readonly requiredAccountContexts: readonly AccountContext[];
  readonly currentAccountContexts: readonly AccountContext[];
  readonly missingAccountContexts: readonly AccountContext[];
  readonly materializationInScope: false;
} {
  const currentAccountContexts = normalizeAccountContexts(
    params.currentAccountContexts,
  );
  const requiredAccountContexts = normalizeAccountContexts(
    params.requiredAccountContexts,
  );
  const missingAccountContexts = requiredAccountContexts.filter(
    (context) => !currentAccountContexts.includes(context),
  );
  const status =
    requiredAccountContexts.length === 0
      ? "NOT_REQUIRED"
      : !params.targetUserResolved
        ? "TARGET_USER_UNRESOLVED"
        : missingAccountContexts.length > 0
          ? "MISSING_REQUIRED_CONTEXT"
          : "SATISFIED";

  return {
    status,
    requiredAccountContexts,
    currentAccountContexts,
    missingAccountContexts,
    materializationInScope: false,
  };
}

function buildConsoleEntitlementPreview(params: {
  readonly currentAccountContexts: readonly AccountContext[];
  readonly proposedContexts: readonly AccountContext[];
  readonly missingRequiredAccountContexts: readonly AccountContext[];
  readonly responsibilityRequirements: readonly Record<string, unknown>[];
  readonly blockers: readonly Record<string, unknown>[];
}): Record<string, unknown> {
  const current = normalizeAccountContexts(params.currentAccountContexts);
  const proposed = [...new Set([...current, ...params.proposedContexts])];
  const missingRequired = new Set(
    normalizeAccountContexts(params.missingRequiredAccountContexts),
  );
  return {
    previewOnly: true,
    accountContextMutated: false,
    grantsAuthorityByItself: false,
    consoles: (["STAFF_CONSOLE", "MANAGER_CONSOLE", "ADMIN_CONSOLE"] as const).map(
      (context) => {
        const currentlyEligible = current.includes(context);
        const proposedEligible = proposed.includes(context);
        const accountContextBlocked = missingRequired.has(context);
        const managerBlocked =
          context === "MANAGER_CONSOLE" &&
          params.responsibilityRequirements.some(
            (item) => item.status !== "SATISFIED",
          );
        const consoleBlockers = [
          ...(accountContextBlocked ? ["REQUIRED_ACCOUNT_CONTEXT_MISSING"] : []),
          ...(managerBlocked ? ["RESPONSIBILITY_REQUIRED"] : []),
        ];
        return {
          console: context,
          currentlyEligible,
          proposedEligible:
            proposedEligible && !accountContextBlocked && !managerBlocked,
          blockers: consoleBlockers,
          reasonCodes: proposedEligible
            ? consoleBlockers.length > 0
              ? consoleBlockers
              : ["BACKEND_DERIVED_FROM_ASSIGNMENT_TARGET"]
            : ["NO_MATCHING_ACCOUNT_CONTEXT_OR_ASSIGNMENT_TARGET"],
        };
      },
    ),
    blockerCodes: params.blockers.map((item) => item.code),
  };
}

function buildEffectiveAccessDelta(
  current: Record<string, unknown> | null,
  proposed: Record<string, unknown> | null,
): Record<string, unknown> {
  const currentPermissions = new Set(readStringArray(current?.permissions));
  const proposedPermissions = new Set(readStringArray(proposed?.permissions));
  return {
    addedPermissions: [...proposedPermissions].filter(
      (permission) => !currentPermissions.has(permission),
    ),
    removedPermissions: [...currentPermissions].filter(
      (permission) => !proposedPermissions.has(permission),
    ),
    unchangedPermissions: [...proposedPermissions].filter((permission) =>
      currentPermissions.has(permission),
    ),
  };
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function requirementForRole(roleCode: string):
  | (typeof MANAGER_REQUIREMENTS)[keyof typeof MANAGER_REQUIREMENTS]
  | null {
  if (roleCode === "TALENT_GROUP_MANAGER") {
    return MANAGER_REQUIREMENTS.TALENT_GROUP_MANAGER;
  }
  if (roleCode === "ORG_UNIT_MANAGER") {
    return MANAGER_REQUIREMENTS.ORG_UNIT_MANAGER;
  }
  return null;
}

function isManagerRoleCode(roleCode: string): boolean {
  return roleCode === "TALENT_GROUP_MANAGER" || roleCode === "ORG_UNIT_MANAGER";
}

function requiredResponsibilityTypeForRole(roleCode: string): string | null {
  return requirementForRole(roleCode)?.responsibilityType ?? null;
}

function blocker(code: string, summary: string): Record<string, unknown> {
  return { severity: "BLOCKER", code, summary };
}

function warning(code: string, summary: string): Record<string, unknown> {
  return { severity: "WARNING", code, summary };
}

function normalizeRequiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new RoleValidationError(`${field} is required`);
  }
  return value.trim();
}

function normalizeNullableText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new RoleValidationError(`${field} must be a string`);
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalTimestamp(
  value: unknown,
  field: string,
): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const timestamp =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Date.parse(value)
        : Number.NaN;
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new RoleValidationError(`${field} must be a timestamp or ISO date`);
  }
  return Math.trunc(timestamp);
}

function assertAssignmentDates(
  effectiveAt: number,
  expiresAt: number | null,
  reviewAt: number | null,
): void {
  if (expiresAt !== null && expiresAt <= effectiveAt) {
    throw new RoleValidationError("expiresAt must be after effectiveAt");
  }
  if (reviewAt !== null && reviewAt < effectiveAt) {
    throw new RoleValidationError("reviewAt must not be before effectiveAt");
  }
}

function commandSourceActorId(command: AccessAssignmentPreviewCommand): string {
  return command.actorUserId ?? "";
}
