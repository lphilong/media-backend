import {
  PlainObject,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { ExposurePolicy } from "@core/exposure/exposure.policy";
import {
  RoleAssignmentRuleView,
  RoleAssignmentView,
  RoleDetailView,
  RoleListItemView,
  RoleMutationView,
  RolePermissionMatrixView,
} from "@modules/role/domain/role.types";
import {
  RoleTemplateDefinition,
  RoleTemplateListItem,
  RoleTemplateScopePlanEntry,
} from "@modules/role/domain/role-template.catalog";
import { RoleTemplatePreviewResult } from "./role.contracts";

const ROLE_ASSIGNMENT_RULE_FIELDS = [
  "id",
  "code",
  "description",
  "state",
  "conditions",
] as const;

const ROLE_ADMIN_MUTATION_FIELDS = [
  "id",
  "code",
  "name",
  "description",
  "state",
  "permissions",
  "delegationBand",
  "maxDelegatableBand",
  "assignmentRules",
  "templateCode",
  "templateVersion",
  "templateAppliedAt",
  "updatedAt",
  "activatedAt",
  "archivedAt",
] as const;

const ROLE_ADMIN_LIST_FIELDS = [
  "id",
  "code",
  "name",
  "state",
  "permissionsSummary",
  "assignmentCountSummary",
  "templateCode",
  "templateVersion",
  "templateAppliedAt",
  "updatedAt",
] as const;

const ROLE_ADMIN_DETAIL_FIELDS = [
  "id",
  "code",
  "name",
  "description",
  "state",
  "permissions",
  "delegationBand",
  "maxDelegatableBand",
  "assignmentRules",
  "templateCode",
  "templateVersion",
  "templateAppliedAt",
  "createdAt",
  "updatedAt",
  "activatedAt",
  "archivedAt",
] as const;

const ROLE_TEMPLATE_FIELDS = [
  "code",
  "version",
  "name",
  "description",
  "category",
  "recommendedAccountContext",
  "permissionCount",
  "permissions",
  "recommendedScopeGrants",
  "scopePlan",
  "warnings",
  "implementationNotes",
  "status",
  "assignabilityStatus",
  "featureStatus",
  "operatorFlowGroup",
  "sensitivityLevel",
  "reviewPolicy",
  "accountContextLifecyclePolicy",
  "responsibilityPolicy",
  "scopeSelectorSupport",
  "futureReadinessNote",
  "legacyVisibility",
] as const;

const ROLE_TEMPLATE_SCOPE_PLAN_FIELDS = [
  "module",
  "scopes",
  "status",
  "note",
] as const;

const ROLE_TEMPLATE_PREVIEW_FIELDS = [
  "template",
  "permissions",
  "scopePlan",
  "warnings",
  "unsupportedScopeNotes",
] as const;

const ROLE_ADMIN_ASSIGNMENT_FIELDS = [
  "assignmentId",
  "roleId",
  "userId",
  "roleRef",
  "userRef",
  "scopeGrants",
  "structuredScopeGrants",
  "scopeFingerprint",
  "state",
  "effectiveAt",
  "expiresAt",
  "reviewAt",
  "assignedBy",
  "assignedAt",
  "revokedAt",
  "revokedBy",
  "revokeReason",
  "origin",
  "bundleOrigin",
  "reason",
] as const;

const ROLE_ADMIN_PERMISSION_MATRIX_FIELDS = [
  "roleId",
  "roleCode",
  "roleState",
  "permissions",
  "delegationBand",
  "maxDelegatableBand",
] as const;

function toPermissionObjects(
  values: readonly string[],
): readonly PlainObject[] {
  return values.map((code) => ({ code }));
}

function exposeAssignmentRule(rule: RoleAssignmentRuleView): PlainObject {
  return toPlainObject(
    ExposurePolicy.expose(
      {
        id: rule.id,
        code: rule.code,
        description: rule.description,
        state: rule.state,
        conditions: rule.conditions,
      },
      ROLE_ASSIGNMENT_RULE_FIELDS,
    ),
    "RoleAssignmentRule exposure",
  );
}

function exposeAssignmentRules(
  rules: readonly RoleAssignmentRuleView[],
): readonly PlainObject[] {
  return rules.map((rule) => exposeAssignmentRule(rule));
}

export const RoleAdminMutationExposure = Object.freeze({
  expose(input: RoleMutationView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          id: input.id,
          code: input.code,
          name: input.name,
          description: input.description,
          state: input.state,
          permissions: toPermissionObjects(input.permissions),
          delegationBand: input.delegationBand,
          maxDelegatableBand: input.maxDelegatableBand,
          assignmentRules: exposeAssignmentRules(input.assignmentRules),
          templateCode: input.templateCode ?? null,
          templateVersion: input.templateVersion ?? null,
          templateAppliedAt: input.templateAppliedAt ?? null,
          updatedAt: input.updatedAt,
          activatedAt: input.activatedAt,
          archivedAt: input.archivedAt,
        },
        ROLE_ADMIN_MUTATION_FIELDS,
      ),
      "RoleAdminMutation exposure",
    );
  },
});

export const RoleAdminListExposure = Object.freeze({
  expose(input: RoleListItemView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          id: input.id,
          code: input.code,
          name: input.name,
          state: input.state,
          permissionsSummary: input.permissionsSummary,
          assignmentCountSummary: input.assignmentCountSummary,
          templateCode: input.templateCode ?? null,
          templateVersion: input.templateVersion ?? null,
          templateAppliedAt: input.templateAppliedAt ?? null,
          updatedAt: input.updatedAt,
        },
        ROLE_ADMIN_LIST_FIELDS,
      ),
      "RoleAdminList exposure",
    );
  },

  exposeMany(items: readonly RoleListItemView[]): readonly PlainObject[] {
    return items.map((item) => this.expose(item));
  },
});

export const RoleAdminDetailExposure = Object.freeze({
  expose(input: RoleDetailView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          id: input.id,
          code: input.code,
          name: input.name,
          description: input.description,
          state: input.state,
          permissions: toPermissionObjects(input.permissions),
          delegationBand: input.delegationBand,
          maxDelegatableBand: input.maxDelegatableBand,
          assignmentRules: exposeAssignmentRules(input.assignmentRules),
          templateCode: input.templateCode ?? null,
          templateVersion: input.templateVersion ?? null,
          templateAppliedAt: input.templateAppliedAt ?? null,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
          activatedAt: input.activatedAt,
          archivedAt: input.archivedAt,
        },
        ROLE_ADMIN_DETAIL_FIELDS,
      ),
      "RoleAdminDetail exposure",
    );
  },
});

export const RoleAdminAssignmentExposure = Object.freeze({
  expose(input: RoleAssignmentView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          assignmentId: input.assignmentId,
          roleId: input.roleId,
          userId: input.userId,
          roleRef: input.roleRef,
          userRef: input.userRef,
          scopeGrants: input.scopeGrants ?? null,
          structuredScopeGrants: input.structuredScopeGrants ?? [],
          scopeFingerprint: input.scopeFingerprint ?? "scope:v1:legacy",
          state: input.state,
          effectiveAt: input.effectiveAt,
          expiresAt: input.expiresAt ?? null,
          reviewAt: input.reviewAt ?? null,
          assignedBy: input.assignedBy ?? null,
          assignedAt: input.assignedAt ?? input.effectiveAt,
          revokedAt: input.revokedAt,
          revokedBy: input.revokedBy ?? null,
          revokeReason: input.revokeReason ?? null,
          origin: input.origin ?? "LEGACY",
          bundleOrigin: input.bundleOrigin ?? null,
          reason: input.reason,
        },
        ROLE_ADMIN_ASSIGNMENT_FIELDS,
      ),
      "RoleAdminAssignment exposure",
    );
  },

  exposeMany(items: readonly RoleAssignmentView[]): readonly PlainObject[] {
    return items.map((item) => this.expose(item));
  },
});

export const RoleAdminPermissionMatrixExposure = Object.freeze({
  expose(input: RolePermissionMatrixView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          roleId: input.roleId,
          roleCode: input.roleCode,
          roleState: input.roleState,
          permissions: toPermissionObjects(input.permissions),
          delegationBand: input.delegationBand,
          maxDelegatableBand: input.maxDelegatableBand,
        },
        ROLE_ADMIN_PERMISSION_MATRIX_FIELDS,
      ),
      "RoleAdminPermissionMatrix exposure",
    );
  },
});

function exposeScopePlanEntry(entry: RoleTemplateScopePlanEntry): PlainObject {
  return toPlainObject(
    ExposurePolicy.expose(
      {
        module: entry.module,
        scopes: [...entry.scopes],
        status: entry.status,
        note: entry.note,
      },
      ROLE_TEMPLATE_SCOPE_PLAN_FIELDS,
    ),
    "RoleTemplateScopePlan exposure",
  );
}

function exposeScopePlan(
  scopePlan: readonly RoleTemplateScopePlanEntry[],
): readonly PlainObject[] {
  return scopePlan.map((entry) => exposeScopePlanEntry(entry));
}

function exposeRoleTemplateBase(
  template: RoleTemplateDefinition | RoleTemplateListItem,
): PlainObject {
  const permissionCount =
    "permissionCount" in template
      ? template.permissionCount
      : template.permissions.length;
  const permissions =
    "permissions" in template
      ? toPermissionObjects(template.permissions)
      : undefined;

  return toPlainObject(
    ExposurePolicy.expose(
      {
        code: template.code,
        version: template.version,
        name: template.name,
        description: template.description,
        category: template.category,
        recommendedAccountContext: template.recommendedAccountContext,
        permissionCount,
        ...(permissions ? { permissions } : {}),
        recommendedScopeGrants: template.recommendedScopeGrants,
        scopePlan: exposeScopePlan(template.scopePlan),
        warnings: [...template.warnings],
        implementationNotes: [...template.implementationNotes],
        status: template.status,
        assignabilityStatus: template.assignabilityStatus,
        featureStatus: template.featureStatus,
        operatorFlowGroup: template.operatorFlowGroup,
        sensitivityLevel: template.sensitivityLevel,
        reviewPolicy: template.reviewPolicy,
        accountContextLifecyclePolicy: template.accountContextLifecyclePolicy,
        responsibilityPolicy: template.responsibilityPolicy,
        scopeSelectorSupport: template.scopeSelectorSupport,
        futureReadinessNote: template.futureReadinessNote,
        legacyVisibility: template.legacyVisibility,
      },
      ROLE_TEMPLATE_FIELDS,
    ),
    "RoleTemplate exposure",
  );
}

export const RoleTemplateAdminListExposure = Object.freeze({
  expose(input: RoleTemplateListItem): PlainObject {
    return exposeRoleTemplateBase(input);
  },

  exposeMany(items: readonly RoleTemplateListItem[]): readonly PlainObject[] {
    return items.map((item) => this.expose(item));
  },
});

export const RoleTemplateAdminPreviewExposure = Object.freeze({
  expose(input: RoleTemplatePreviewResult): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          template: exposeRoleTemplateBase(input.template),
          permissions: toPermissionObjects(input.permissions),
          scopePlan: exposeScopePlan(input.scopePlan),
          warnings: [...input.warnings],
          unsupportedScopeNotes: [...input.unsupportedScopeNotes],
        },
        ROLE_TEMPLATE_PREVIEW_FIELDS,
      ),
      "RoleTemplatePreview exposure",
    );
  },
});
