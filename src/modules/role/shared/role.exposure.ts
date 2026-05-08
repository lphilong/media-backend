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
  "createdAt",
  "updatedAt",
  "activatedAt",
  "archivedAt",
] as const;

const ROLE_ADMIN_ASSIGNMENT_FIELDS = [
  "assignmentId",
  "roleId",
  "userId",
  "state",
  "effectiveAt",
  "revokedAt",
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

function exposeAssignmentRule(
  rule: RoleAssignmentRuleView,
): PlainObject {
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
  return rules.map((rule) =>
    exposeAssignmentRule(rule),
  );
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
          permissions: toPermissionObjects(
            input.permissions,
          ),
          delegationBand: input.delegationBand,
          maxDelegatableBand:
            input.maxDelegatableBand,
          assignmentRules: exposeAssignmentRules(
            input.assignmentRules,
          ),
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
          permissionsSummary:
            input.permissionsSummary,
          assignmentCountSummary:
            input.assignmentCountSummary,
          updatedAt: input.updatedAt,
        },
        ROLE_ADMIN_LIST_FIELDS,
      ),
      "RoleAdminList exposure",
    );
  },

  exposeMany(
    items: readonly RoleListItemView[],
  ): readonly PlainObject[] {
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
          permissions: toPermissionObjects(
            input.permissions,
          ),
          delegationBand: input.delegationBand,
          maxDelegatableBand:
            input.maxDelegatableBand,
          assignmentRules: exposeAssignmentRules(
            input.assignmentRules,
          ),
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
          state: input.state,
          effectiveAt: input.effectiveAt,
          revokedAt: input.revokedAt,
          reason: input.reason,
        },
        ROLE_ADMIN_ASSIGNMENT_FIELDS,
      ),
      "RoleAdminAssignment exposure",
    );
  },

  exposeMany(
    items: readonly RoleAssignmentView[],
  ): readonly PlainObject[] {
    return items.map((item) => this.expose(item));
  },
});

export const RoleAdminPermissionMatrixExposure =
  Object.freeze({
    expose(
      input: RolePermissionMatrixView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            roleId: input.roleId,
            roleCode: input.roleCode,
            roleState: input.roleState,
            permissions: toPermissionObjects(
              input.permissions,
            ),
            delegationBand: input.delegationBand,
            maxDelegatableBand:
              input.maxDelegatableBand,
          },
          ROLE_ADMIN_PERMISSION_MATRIX_FIELDS,
        ),
        "RoleAdminPermissionMatrix exposure",
      );
    },
  });
