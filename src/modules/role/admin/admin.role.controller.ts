import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import {
  ROLE_ADMIN_MUTATION_PRESENTER_KEY,
} from "@modules/role/shared/role.presenter-keys";
import { RoleValidationError } from "@modules/role/domain/role.errors";
import {
  ActivateRoleCommand,
  ArchiveRoleCommand,
  AssignRoleToUserCommand,
  CreateRoleCommand,
  DeactivateRoleCommand,
  RevokeRoleFromUserCommand,
  SetRoleAssignmentRulesCommand,
  SetRolePermissionsCommand,
  UpdateRoleCommand,
} from "@modules/role/shared/role.contracts";
import { RoleAdminService } from "./admin.role.service";

type RoleMutationCommand =
  | "ROLE_CREATE"
  | "ROLE_UPDATE"
  | "ROLE_ACTIVATE"
  | "ROLE_DEACTIVATE"
  | "ROLE_ARCHIVE"
  | "ROLE_PERMISSION_ASSIGN"
  | "ROLE_ASSIGNMENT_RULE_SET"
  | "ROLE_ASSIGN_TO_USER"
  | "ROLE_REVOKE_FROM_USER";

const CREATE_ROLE_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "name",
    "code",
    "description",
    "initialPermissions",
    "initialDelegationBand",
    "initialMaxDelegatableBand",
    "initialAssignmentRules",
  ]);

const UPDATE_ROLE_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "name",
    "description",
    "delegationBand",
    "maxDelegatableBand",
  ]);

const SET_ROLE_PERMISSIONS_BODY_FIELDS: readonly string[] =
  Object.freeze(["permissions"]);

const SET_ROLE_ASSIGNMENT_RULES_BODY_FIELDS: readonly string[] =
  Object.freeze(["rules"]);

const ROLE_ASSIGNMENT_RULE_FIELDS: readonly string[] =
  Object.freeze([
    "id",
    "code",
    "description",
    "state",
    "conditions",
  ]);

const ASSIGN_ROLE_TO_USER_BODY_FIELDS: readonly string[] =
  Object.freeze(["userId", "reason"]);

const OPTIONAL_REASON_BODY_FIELDS: readonly string[] =
  Object.freeze(["reason"]);

export class AdminRoleController extends SecureController {
  constructor(
    private readonly service: RoleAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<RoleMutationCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Role mutation command missing",
      );
    }

    switch (command) {
      case "ROLE_CREATE":
        return this.service.createRole(
          actor,
          parseCreateRoleCommand(req),
        );

      case "ROLE_UPDATE":
        return this.service.updateRole(
          actor,
          parseUpdateRoleCommand(req),
        );

      case "ROLE_ACTIVATE":
        return this.service.activateRole(
          actor,
          parseActivateRoleCommand(req),
        );

      case "ROLE_DEACTIVATE":
        return this.service.deactivateRole(
          actor,
          parseDeactivateRoleCommand(req),
        );

      case "ROLE_ARCHIVE":
        return this.service.archiveRole(
          actor,
          parseArchiveRoleCommand(req),
        );

      case "ROLE_PERMISSION_ASSIGN":
        return this.service.setRolePermissions(
          actor,
          parseSetRolePermissionsCommand(req),
        );

      case "ROLE_ASSIGNMENT_RULE_SET":
        return this.service.setRoleAssignmentRules(
          actor,
          parseSetRoleAssignmentRulesCommand(req),
        );

      case "ROLE_ASSIGN_TO_USER":
        return this.service.assignRoleToUser(
          actor,
          parseAssignRoleToUserCommand(req),
        );

      case "ROLE_REVOKE_FROM_USER":
        return this.service.revokeRoleFromUser(
          actor,
          parseRevokeRoleFromUserCommand(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported role mutation command: ${command}`,
        );
    }
  }

  protected async present(
    result: unknown,
    req: Request,
    _actor: Actor,
    context: ContextType,
  ): Promise<PresentationResult> {
    return getPresenterRegistryFromRequest(req)
      .get<unknown, PresentationResult>(
        ROLE_ADMIN_MUTATION_PRESENTER_KEY,
      )
      .present(result, context);
  }
}

function parseCreateRoleCommand(
  req: Request,
): CreateRoleCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CREATE_ROLE_BODY_FIELDS,
    "ROLE_CREATE",
  );
  assertNoUnexpectedAssignmentRuleFields(
    body.initialAssignmentRules,
    "ROLE_CREATE",
  );

  return {
    name: body.name as string,
    code: body.code as string,
    description:
      body.description === undefined
        ? null
        : (body.description as string | null),
    initialPermissions:
      body.initialPermissions as
        | readonly string[]
        | undefined,
    initialDelegationBand:
      body.initialDelegationBand as
        | CreateRoleCommand["initialDelegationBand"]
        | undefined,
    initialMaxDelegatableBand:
      body.initialMaxDelegatableBand as
        | CreateRoleCommand["initialMaxDelegatableBand"]
        | undefined,
    initialAssignmentRules:
      body.initialAssignmentRules as
        | SetRoleAssignmentRulesCommand["rules"]
        | undefined,
  };
}

function parseUpdateRoleCommand(
  req: Request,
): UpdateRoleCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_ROLE_BODY_FIELDS,
    "ROLE_UPDATE",
  );

  return {
    roleId: req.params.roleId,
    name: body.name as string | null | undefined,
    description:
      body.description as
        | string
        | null
        | undefined,
    delegationBand:
      body.delegationBand as
        | UpdateRoleCommand["delegationBand"]
        | undefined,
    maxDelegatableBand:
      body.maxDelegatableBand as
        | UpdateRoleCommand["maxDelegatableBand"]
        | undefined,
  };
}

function parseActivateRoleCommand(
  req: Request,
): ActivateRoleCommand {
  assertNoUnexpectedFields(
    requirePlainObjectBodyForZeroBodyMutation(
      req.body,
      "ROLE_ACTIVATE",
    ),
    [],
    "ROLE_ACTIVATE",
  );

  return {
    roleId: req.params.roleId,
  };
}

function parseDeactivateRoleCommand(
  req: Request,
): DeactivateRoleCommand {
  const body =
    requirePlainObjectBodyForOptionalReasonMutation(
      req.body,
      "ROLE_DEACTIVATE",
    );
  assertNoUnexpectedFields(
    body,
    OPTIONAL_REASON_BODY_FIELDS,
    "ROLE_DEACTIVATE",
  );

  return {
    roleId: req.params.roleId,
    reason:
      body.reason === undefined
        ? null
        : (body.reason as string | null),
  };
}

function parseArchiveRoleCommand(
  req: Request,
): ArchiveRoleCommand {
  const body =
    requirePlainObjectBodyForOptionalReasonMutation(
      req.body,
      "ROLE_ARCHIVE",
    );
  assertNoUnexpectedFields(
    body,
    OPTIONAL_REASON_BODY_FIELDS,
    "ROLE_ARCHIVE",
  );

  return {
    roleId: req.params.roleId,
    reason:
      body.reason === undefined
        ? null
        : (body.reason as string | null),
  };
}

function parseSetRolePermissionsCommand(
  req: Request,
): SetRolePermissionsCommand {
  const body = requireRequiredArrayFieldBody(
    req.body,
    SET_ROLE_PERMISSIONS_BODY_FIELDS,
    "permissions",
    "ROLE_PERMISSION_ASSIGN",
  );

  return {
    roleId: req.params.roleId,
    permissions:
      body.permissions as readonly string[],
  };
}

function parseSetRoleAssignmentRulesCommand(
  req: Request,
): SetRoleAssignmentRulesCommand {
  const body = requireRequiredArrayFieldBody(
    req.body,
    SET_ROLE_ASSIGNMENT_RULES_BODY_FIELDS,
    "rules",
    "ROLE_ASSIGNMENT_RULE_SET",
  );
  assertNoUnexpectedAssignmentRuleFields(
    body.rules,
    "ROLE_ASSIGNMENT_RULE_SET",
  );

  return {
    roleId: req.params.roleId,
    rules:
      body.rules as readonly SetRoleAssignmentRulesCommand["rules"][number][],
  };
}

function parseAssignRoleToUserCommand(
  req: Request,
): AssignRoleToUserCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    ASSIGN_ROLE_TO_USER_BODY_FIELDS,
    "ROLE_ASSIGN_TO_USER",
  );

  return {
    roleId: req.params.roleId,
    userId: body.userId as string,
    reason:
      body.reason === undefined
        ? null
        : (body.reason as string | null),
    effectiveAt:
      body.effectiveAt === undefined
        ? null
        : (body.effectiveAt as number | string | null),
  };
}

function parseRevokeRoleFromUserCommand(
  req: Request,
): RevokeRoleFromUserCommand {
  const body =
    requirePlainObjectBodyForOptionalReasonMutation(
      req.body,
      "ROLE_REVOKE_FROM_USER",
    );
  assertNoUnexpectedFields(
    body,
    OPTIONAL_REASON_BODY_FIELDS,
    "ROLE_REVOKE_FROM_USER",
  );

  return {
    roleId: req.params.roleId,
    assignmentId: req.params.assignmentId,
    reason:
      body.reason === undefined
        ? null
        : (body.reason as string | null),
  };
}

function requireRecord(
  value: unknown,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return {};
  }

  return value as Record<string, unknown>;
}

function requireRequiredArrayFieldBody(
  value: unknown,
  allowedFields: readonly string[],
  requiredField: string,
  command: RoleMutationCommand,
): Record<string, unknown> {
  const body = requirePlainObjectBody(
    value,
    command,
  );
  assertNoUnexpectedFields(
    body,
    allowedFields,
    command,
  );

  if (
    !Object.prototype.hasOwnProperty.call(
      body,
      requiredField,
    )
  ) {
    throw new RoleValidationError(
      `${command} payload must include ${requiredField}`,
    );
  }

  if (!Array.isArray(body[requiredField])) {
    throw new RoleValidationError(
      `${requiredField} must be an array`,
    );
  }

  return body;
}

function requirePlainObjectBodyForZeroBodyMutation(
  value: unknown,
  command: RoleMutationCommand,
): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  return requirePlainObjectBody(value, command);
}

function requirePlainObjectBodyForOptionalReasonMutation(
  value: unknown,
  command: RoleMutationCommand,
): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  return requirePlainObjectBody(value, command);
}

function requirePlainObjectBody(
  value: unknown,
  command: RoleMutationCommand,
): Record<string, unknown> {
  if (
    !isPlainObject(value)
  ) {
    throw new RoleValidationError(
      `Request body for ${command} must be a plain object`,
    );
  }

  return value;
}

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return (
    prototype === Object.prototype ||
    prototype === null
  );
}

function assertNoUnexpectedFields(
  body: Readonly<Record<string, unknown>>,
  allowedFields: readonly string[],
  command: RoleMutationCommand,
): void {
  const unexpectedFields = Object.keys(body).filter(
    (field) => !allowedFields.includes(field),
  );

  if (unexpectedFields.length === 0) {
    return;
  }

  unexpectedFields.sort();

  throw new RoleValidationError(
    `${command} payload contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}

function assertNoUnexpectedAssignmentRuleFields(
  rules: unknown,
  command: RoleMutationCommand,
): void {
  if (!Array.isArray(rules)) {
    return;
  }

  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    if (
      typeof rule !== "object" ||
      rule === null ||
      Array.isArray(rule)
    ) {
      continue;
    }

    const unexpectedFields = Object.keys(rule).filter(
      (field) =>
        !ROLE_ASSIGNMENT_RULE_FIELDS.includes(field),
    );

    if (unexpectedFields.length === 0) {
      continue;
    }

    unexpectedFields.sort();

    throw new RoleValidationError(
      `${command} assignment rule ${index} contains unsupported field(s): ${unexpectedFields.join(", ")}`,
    );
  }
}
