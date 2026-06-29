import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { PresentationResult, toPlainObject } from "@app/base/presentation-result.types";
import { SecureController } from "@app/base/secure-controller.base";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { RoleValidationError } from "@modules/role/domain/role.errors";
import {
  AccessAssignmentPreviewAdminService,
  AccessAssignmentPreviewCommand,
  AccessAssignmentSourceContext,
} from "./admin.access-assignment-preview.service";
import { AccessAssignmentApplyAdminService } from "./admin.access-assignment-apply.service";

type AccessAssignmentCommand =
  | "ACCESS_ASSIGNMENT_PREVIEW"
  | "ACCESS_ASSIGNMENT_APPLY"
  | "ACCESS_ASSIGNMENT_TARGET_OPTIONS";

const PREVIEW_FIELDS = Object.freeze([
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
]);

const SOURCE_CONTEXT_FIELDS = Object.freeze([
  "talentGroupId",
  "orgUnitId",
  "platformAccountId",
  "eventId",
  "studioResourceId",
  "financePeriod",
  "payrollPeriod",
  "attendancePeriodOrgUnitId",
]);

const FORBIDDEN_FRONTEND_AUTHORITY_FIELDS = new Set([
  "accountContext",
  "accountContexts",
  "console",
  "consoleCode",
  "workspaceAvailability",
  "primaryWorkspace",
  "actorKind",
  "entitlement",
  "manualEntitlement",
  "manualEntitlements",
  "manualConsoleEntitlement",
  "consoleEntitlement",
  "consoleEntitlements",
  "entitlements",
  "workspaceEntitlement",
  "workspaceEntitlements",
  "workspace",
]);

export class AdminAccessAssignmentPreviewController extends SecureController {
  constructor(
    private readonly service: AccessAssignmentPreviewAdminService,
    private readonly applyService?: AccessAssignmentApplyAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command = readCommand<AccessAssignmentCommand>(req);
    PermissionGuard.assertAdminActor(actor);

    switch (command) {
      case "ACCESS_ASSIGNMENT_PREVIEW":
        PermissionGuard.assert(
          actor,
          PermissionResolver.resolve(Permission.ROLE_ASSIGN_TO_USER),
        );
        return this.service.preview({
          ...parsePreviewCommand(req),
          actorUserId: actor.id,
        });

      case "ACCESS_ASSIGNMENT_APPLY":
        PermissionGuard.assert(
          actor,
          PermissionResolver.resolve(Permission.ROLE_ASSIGN_TO_USER),
        );
        if (!this.applyService) {
          throw new SystemInvariantError(
            "SYSTEM_INVARIANT_VIOLATION",
            "Access assignment apply service missing",
          );
        }
        return this.applyService.apply(actor, {
          ...parsePreviewCommand(req),
          actorUserId: actor.id,
        });

      case "ACCESS_ASSIGNMENT_TARGET_OPTIONS":
        PermissionGuard.assert(
          actor,
          PermissionResolver.resolve(Permission.ROLE_ASSIGNMENT_VIEW),
        );
        assertNoUnexpectedFields(requirePlainObjectBody(req.body), [], command);
        return this.service.listTargetOptions();

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          "Access assignment preview command missing",
        );
    }
  }

  protected async present(
    result: unknown,
    _req: Request,
    _actor: Actor,
    _context: ContextType,
  ): Promise<PresentationResult> {
    return { data: toPlainObject(result, "accessAssignmentPreview") };
  }
}

function parsePreviewCommand(req: Request): AccessAssignmentPreviewCommand {
  const body = requirePlainObjectBody(req.body);
  assertNoForbiddenAuthorityFields(body, "ACCESS_ASSIGNMENT_PREVIEW");
  assertNoUnexpectedFields(body, PREVIEW_FIELDS, "ACCESS_ASSIGNMENT_PREVIEW");
  const sourceContext = parseSourceContext(body.sourceContext);

  return {
    targetUserId: body.targetUserId as string,
    assignmentTargetType:
      body.assignmentTargetType as AccessAssignmentPreviewCommand["assignmentTargetType"],
    assignmentTargetId: body.assignmentTargetId as string | undefined,
    assignmentTargetCode: body.assignmentTargetCode as string | undefined,
    bundleVersion: body.bundleVersion as string | undefined,
    structuredScopeGrants:
      body.structuredScopeGrants as AccessAssignmentPreviewCommand["structuredScopeGrants"],
    reason: body.reason === undefined ? null : (body.reason as string | null),
    effectiveAt:
      body.effectiveAt === undefined
        ? null
        : (body.effectiveAt as string | number | null),
    expiresAt:
      body.expiresAt === undefined
        ? null
        : (body.expiresAt as string | number | null),
    reviewAt:
      body.reviewAt === undefined
        ? null
        : (body.reviewAt as string | number | null),
    ...(sourceContext ? { sourceContext } : {}),
  };
}

function parseSourceContext(value: unknown): AccessAssignmentSourceContext | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isPlainObject(value)) {
    throw new RoleValidationError("sourceContext must be a plain object");
  }
  assertNoUnexpectedFields(
    value,
    SOURCE_CONTEXT_FIELDS,
    "ACCESS_ASSIGNMENT_PREVIEW.sourceContext",
  );
  return value as AccessAssignmentSourceContext;
}

function requirePlainObjectBody(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (!isPlainObject(value)) {
    throw new RoleValidationError("Request body must be a plain object");
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNoUnexpectedFields(
  body: Readonly<Record<string, unknown>>,
  allowedFields: readonly string[],
  command: string,
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

function assertNoForbiddenAuthorityFields(
  body: Readonly<Record<string, unknown>>,
  command: string,
): void {
  const forbidden = Object.keys(body).filter((field) =>
    FORBIDDEN_FRONTEND_AUTHORITY_FIELDS.has(field),
  );
  if (forbidden.length === 0) {
    return;
  }
  forbidden.sort();
  throw new RoleValidationError(
    `${command} payload contains backend-owned authority field(s): ${forbidden.join(", ")}`,
  );
}
