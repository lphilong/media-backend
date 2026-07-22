import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import {
  PresentationResult,
  toPlainObject,
} from "@app/base/presentation-result.types";
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
import { AccessAssignmentLifecycleAdminService } from "./admin.access-assignment-lifecycle.service";
import { AccessLifecycleP2AdminService } from "./admin.access-lifecycle-p2.service";
import { AccessBreakGlassAdminService } from "./admin.break-glass.service";
import { GovernancePrincipalAdminService } from "./admin.governance-principal.service";

type AccessAssignmentCommand =
  | "ACCESS_ASSIGNMENT_PREVIEW"
  | "ACCESS_ASSIGNMENT_APPLY"
  | "ACCESS_ASSIGNMENT_TARGET_OPTIONS"
  | "ACCESS_ASSIGNMENT_LIST"
  | "ACCESS_ASSIGNMENT_REVOKE"
  | "ACCESS_LIFECYCLE_STATUS"
  | "ACCESS_LIFECYCLE_REVIEW_DECIDE"
  | "ACCESS_LIFECYCLE_GRACE_REQUEST"
  | "ACCESS_LIFECYCLE_GRACE_DECIDE"
  | "ACCESS_LIFECYCLE_SUCCESSOR_REQUEST"
  | "ACCESS_LIFECYCLE_SUCCESSOR_DECIDE"
  | "BREAK_GLASS_LIST"
  | "BREAK_GLASS_REQUEST"
  | "BREAK_GLASS_APPROVE"
  | "BREAK_GLASS_END"
  | "BREAK_GLASS_REVIEW"
  | "GOVERNANCE_STATUS"
  | "GOVERNANCE_SUCCESSOR_PROPOSE"
  | "GOVERNANCE_SUCCESSOR_DECIDE"
  | "GOVERNANCE_SUCCESSOR_ACTIVATE";

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
    private readonly lifecycleService?: AccessAssignmentLifecycleAdminService,
    private readonly lifecycleP2Service?: AccessLifecycleP2AdminService,
    private readonly breakGlassService?: AccessBreakGlassAdminService,
    private readonly governanceService?: GovernancePrincipalAdminService,
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
        return this.service.preview(
          {
            ...parsePreviewCommand(req),
            actorUserId: actor.id,
          },
          { actor },
        );

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

      case "ACCESS_ASSIGNMENT_LIST":
        PermissionGuard.assert(
          actor,
          PermissionResolver.resolve(Permission.ROLE_ASSIGNMENT_VIEW),
        );
        if (!this.lifecycleService) {
          throw new SystemInvariantError(
            "SYSTEM_INVARIANT_VIOLATION",
            "Access assignment lifecycle service missing",
          );
        }
        assertNoUnexpectedFields(requirePlainObjectBody(req.body), [], command);
        return this.lifecycleService.listForTargetUser(req.query.targetUserId);

      case "ACCESS_ASSIGNMENT_REVOKE":
        PermissionGuard.assert(
          actor,
          PermissionResolver.resolve(Permission.ROLE_REVOKE_FROM_USER),
        );
        if (!this.lifecycleService) {
          throw new SystemInvariantError(
            "SYSTEM_INVARIANT_VIOLATION",
            "Access assignment lifecycle service missing",
          );
        }
        return this.lifecycleService.revoke(actor, {
          assignmentId: req.params.assignmentId,
          reason: parseLifecycleReasonCommand(req),
        });

      case "ACCESS_LIFECYCLE_STATUS":
        assertAccessLifecycleReadPermission(actor);
        return this.requireLifecycleP2().listForActor(
          actor,
          parseOptionalQueryText(req.query.targetUserId, "targetUserId"),
          {
            limit: parseOptionalQueryInteger(req.query.limit, "limit"),
            queue: parseOptionalQueue(req.query.queue, [
              "review",
              "grace",
              "successor",
            ] as const),
            cursor: parseOptionalQueryText(req.query.cursor, "cursor"),
            reviewCursor: parseOptionalQueryText(
              req.query.reviewCursor,
              "reviewCursor",
            ),
            graceCursor: parseOptionalQueryText(
              req.query.graceCursor,
              "graceCursor",
            ),
            successorCursor: parseOptionalQueryText(
              req.query.successorCursor,
              "successorCursor",
            ),
          },
        );

      case "ACCESS_LIFECYCLE_REVIEW_DECIDE":
        PermissionGuard.assert(
          actor,
          PermissionResolver.resolve(Permission.ROLE_ASSIGNMENT_REVIEW),
        );
        return this.requireLifecycleP2().decideReview(actor, {
          cycleId: req.params.cycleId,
          ...readStrictBody(
            req,
            ["decision", "reason", "nextReviewAt"],
            command,
          ),
        } as never);

      case "ACCESS_LIFECYCLE_GRACE_REQUEST":
        PermissionGuard.assert(
          actor,
          PermissionResolver.resolve(Permission.ROLE_ASSIGNMENT_REVIEW),
        );
        return this.requireLifecycleP2().requestGraceException(
          actor,
          readStrictBody(
            req,
            ["cycleId", "requestedExpiresAt", "reason"],
            command,
          ) as never,
        );

      case "ACCESS_LIFECYCLE_GRACE_DECIDE":
        PermissionGuard.assert(
          actor,
          PermissionResolver.resolve(Permission.ROLE_ASSIGNMENT_GRACE_APPROVE),
        );
        return this.requireLifecycleP2().decideGraceException(actor, {
          exceptionId: req.params.exceptionId,
          ...readStrictBody(req, ["decision", "reason"], command),
        } as never);

      case "ACCESS_LIFECYCLE_SUCCESSOR_REQUEST": {
        const successorRequestBody = readStrictBody(
          req,
          [
            "action",
            "predecessorAssignmentId",
            "roleId",
            "structuredScopeGrants",
            "effectiveAt",
            "expiresAt",
            "reviewAt",
            "riskTier",
            "riskReasons",
            "reason",
            "idempotencyKey",
          ],
          command,
        );
        PermissionGuard.assert(
          actor,
          PermissionResolver.resolve(
            successorRequestBody.action === "REPLACEMENT"
              ? Permission.ROLE_ASSIGNMENT_REPLACE
              : Permission.ROLE_ASSIGNMENT_RENEW,
          ),
        );
        return this.requireLifecycleP2().requestSuccessor(
          actor,
          successorRequestBody as never,
        );
      }

      case "ACCESS_LIFECYCLE_SUCCESSOR_DECIDE":
        if (
          !actor.permissions.includes(Permission.ROLE_ASSIGNMENT_RENEW) &&
          !actor.permissions.includes(Permission.ROLE_ASSIGNMENT_REPLACE)
        ) {
          PermissionGuard.assert(
            actor,
            PermissionResolver.resolve(Permission.ROLE_ASSIGNMENT_RENEW),
          );
        }
        return this.requireLifecycleP2().approveSuccessor(actor, {
          requestId: req.params.requestId,
          ...readStrictBody(req, ["decision", "reason"], command),
        } as never);

      case "BREAK_GLASS_LIST":
        assertBreakGlassReadPermission(actor);
        return this.requireBreakGlass().listForActor(actor, {
          limit: parseOptionalQueryInteger(req.query.limit, "limit"),
          queue: parseOptionalQueue(req.query.queue, [
            "approval",
            "independentReview",
          ] as const),
          cursor: parseOptionalQueryText(req.query.cursor, "cursor"),
          requestCursor: parseOptionalQueryText(
            req.query.requestCursor,
            "requestCursor",
          ),
          activationCursor: parseOptionalQueryText(
            req.query.activationCursor,
            "activationCursor",
          ),
        });

      case "BREAK_GLASS_REQUEST":
        return this.requireBreakGlass().createRequest(
          actor,
          readStrictBody(
            req,
            [
              "targetUserId",
              "permissions",
              "structuredScopeGrants",
              "urgency",
              "incidentReferenceId",
              "reason",
              "durationMs",
              "idempotencyKey",
            ],
            command,
          ) as never,
        );

      case "BREAK_GLASS_APPROVE":
        PermissionGuard.assert(
          actor,
          PermissionResolver.resolve(Permission.BREAK_GLASS_APPROVE),
        );
        return this.requireBreakGlass().approveRequest(actor, {
          requestId: req.params.requestId,
          ...readStrictBody(req, ["decision", "reason"], command),
        } as never);

      case "BREAK_GLASS_REVIEW":
        PermissionGuard.assert(
          actor,
          PermissionResolver.resolve(Permission.BREAK_GLASS_REVIEW),
        );
        return this.requireBreakGlass().reviewActivation(actor, {
          activationId: req.params.activationId,
          ...readStrictBody(req, ["result", "reason"], command),
        } as never);

      case "BREAK_GLASS_END":
        PermissionGuard.assert(
          actor,
          PermissionResolver.resolve(Permission.BREAK_GLASS_END),
        );
        return this.requireBreakGlass().endActivation(actor, {
          activationId: req.params.activationId,
          ...readStrictBody(req, ["reason"], command),
        } as never);

      case "GOVERNANCE_STATUS":
        PermissionGuard.assert(
          actor,
          PermissionResolver.resolve(Permission.OWNER_GOVERNANCE_VIEW),
        );
        return this.requireGovernance().status(actor);

      case "GOVERNANCE_SUCCESSOR_PROPOSE":
        PermissionGuard.assert(
          actor,
          PermissionResolver.resolve(Permission.OWNER_SUCCESSION_MANAGE),
        );
        return this.requireGovernance().proposeSuccessor(
          actor,
          readStrictBody(
            req,
            [
              "targetUserId",
              "effectiveAt",
              "expiresAt",
              "reason",
              "idempotencyKey",
            ],
            command,
          ) as never,
        );

      case "GOVERNANCE_SUCCESSOR_DECIDE":
        PermissionGuard.assert(
          actor,
          PermissionResolver.resolve(Permission.OWNER_SUCCESSION_MANAGE),
        );
        return this.requireGovernance().decideSuccessor(actor, {
          principalId: req.params.principalId,
          ...readStrictBody(
            req,
            ["decision", "reason", "idempotencyKey"],
            command,
          ),
        } as never);

      case "GOVERNANCE_SUCCESSOR_ACTIVATE":
        PermissionGuard.assert(
          actor,
          PermissionResolver.resolve(Permission.OWNER_SUCCESSION_MANAGE),
        );
        return this.requireGovernance().activateSuccessor(actor, {
          principalId: req.params.principalId,
          ...readStrictBody(req, ["reason", "idempotencyKey"], command),
        } as never);

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          "Access assignment preview command missing",
        );
    }
  }

  private requireLifecycleP2(): AccessLifecycleP2AdminService {
    if (!this.lifecycleP2Service) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Access lifecycle P2 service missing",
      );
    }
    return this.lifecycleP2Service;
  }

  private requireBreakGlass(): AccessBreakGlassAdminService {
    if (!this.breakGlassService) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Break-glass service missing",
      );
    }
    return this.breakGlassService;
  }

  private requireGovernance(): GovernancePrincipalAdminService {
    if (!this.governanceService) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Governance principal service missing",
      );
    }
    return this.governanceService;
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

function parseLifecycleReasonCommand(req: Request): unknown {
  const body = requirePlainObjectBody(req.body);
  assertNoForbiddenAuthorityFields(body, "ACCESS_ASSIGNMENT_REVOKE");
  assertNoUnexpectedFields(body, ["reason"], "ACCESS_ASSIGNMENT_REVOKE");
  return body.reason;
}

function readStrictBody(
  req: Request,
  fields: readonly string[],
  command: string,
): Record<string, unknown> {
  const body = requirePlainObjectBody(req.body);
  assertNoForbiddenAuthorityFields(body, command);
  assertNoUnexpectedFields(body, fields, command);
  return body;
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

function parseSourceContext(
  value: unknown,
): AccessAssignmentSourceContext | undefined {
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

function assertBreakGlassReadPermission(actor: Actor): void {
  const boundedReadPermissions = [
    Permission.OWNER_GOVERNANCE_VIEW,
    Permission.BREAK_GLASS_REQUEST,
    Permission.BREAK_GLASS_APPROVE,
    Permission.BREAK_GLASS_ACTIVATE,
    Permission.BREAK_GLASS_END,
    Permission.BREAK_GLASS_REVIEW,
  ] as const;
  if (
    boundedReadPermissions.some((permission) =>
      actor.permissions.includes(permission),
    )
  ) {
    return;
  }
  PermissionGuard.assert(
    actor,
    PermissionResolver.resolve(Permission.OWNER_GOVERNANCE_VIEW),
  );
}

function assertAccessLifecycleReadPermission(actor: Actor): void {
  const permissions = [
    Permission.ROLE_ASSIGNMENT_REVIEW,
    Permission.ROLE_ASSIGNMENT_GRACE_APPROVE,
    Permission.ROLE_ASSIGNMENT_RENEW,
    Permission.ROLE_ASSIGNMENT_REPLACE,
  ] as const;
  if (permissions.some((permission) => actor.permissions.includes(permission)))
    return;
  PermissionGuard.assert(
    actor,
    PermissionResolver.resolve(Permission.ROLE_ASSIGNMENT_REVIEW),
  );
}

function parseOptionalQueryText(value: unknown, field: string): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new RoleValidationError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function parseOptionalQueue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T[number])) {
    throw new RoleValidationError(
      `queue must be exactly one of ${allowed.join(", ")}`,
    );
  }
  return value as T[number];
}

function parseOptionalQueryInteger(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== "string" || !/^\d+$/u.test(text)) {
    throw new RoleValidationError(`${field} must be an integer`);
  }
  return Number(text);
}
