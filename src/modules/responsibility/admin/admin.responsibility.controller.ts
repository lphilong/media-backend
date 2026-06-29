import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import {
  PlainObject,
  PresentationResult,
} from "@app/base/presentation-result.types";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { ResponsibilityValidationError } from "@modules/responsibility/domain/responsibility.errors";
import {
  CreateResponsibilityAssignmentCommand,
  ResponsibilitySubjectType,
  RevokeResponsibilityAssignmentCommand,
  UpdateResponsibilityAssignmentCommand,
} from "@modules/responsibility/domain/responsibility.types";
import { ResponsibilityAdminService } from "./admin.responsibility.service";

type ResponsibilityCommand =
  | "RESPONSIBILITY_ASSIGNMENT_LIST"
  | "RESPONSIBILITY_ASSIGNMENT_DETAIL"
  | "RESPONSIBILITY_ASSIGNMENT_CREATE"
  | "RESPONSIBILITY_ASSIGNMENT_UPDATE"
  | "RESPONSIBILITY_ASSIGNMENT_REVOKE"
  | "RESPONSIBILITY_ASSIGNMENT_SUMMARY";

export class ResponsibilityAdminController extends SecureController {
  constructor(private readonly service: ResponsibilityAdminService) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command = readCommand<ResponsibilityCommand>(req);
    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Responsibility assignment command missing",
      );
    }

    switch (command) {
      case "RESPONSIBILITY_ASSIGNMENT_LIST":
        return this.service.listAssignments(actor, req.query);
      case "RESPONSIBILITY_ASSIGNMENT_DETAIL":
        return this.service.getAssignment(actor, req.params.assignmentId);
      case "RESPONSIBILITY_ASSIGNMENT_CREATE":
        return this.service.createAssignment(actor, parseCreate(req));
      case "RESPONSIBILITY_ASSIGNMENT_UPDATE":
        return this.service.updateAssignment(actor, parseUpdate(req));
      case "RESPONSIBILITY_ASSIGNMENT_REVOKE":
        return this.service.revokeAssignment(actor, parseRevoke(req));
      case "RESPONSIBILITY_ASSIGNMENT_SUMMARY":
        return this.service.getSummaryForSubject(
          actor,
          parseSubjectType(req.params.subjectType),
          req.params.subjectId,
        );
      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported responsibility assignment command: ${command}`,
        );
    }
  }

  protected async present(
    result: unknown,
    _req: Request,
    _actor: Actor,
    _context: ContextType,
  ): Promise<PresentationResult> {
    const record = result as Record<string, unknown>;
    return "items" in record
      ? {
          data: (record.items as readonly PlainObject[]) ?? [],
          meta:
            "inherited" in record
              ? { inherited: record.inherited as readonly PlainObject[] }
              : undefined,
        }
      : { data: record as PlainObject };
  }
}

function parseCreate(req: Request): CreateResponsibilityAssignmentCommand {
  const body = requireRecord(req.body);
  return {
    subjectType: body.subjectType as string,
    subjectId: body.subjectId as string,
    responsibleEmploymentProfileId: body.responsibleEmploymentProfileId as string,
    responsibilityType: body.responsibilityType as string,
    responsibilityRole: body.responsibilityRole as string | null | undefined,
    includeDescendants: body.includeDescendants as boolean | null | undefined,
    actionMask: body.actionMask as readonly string[] | null | undefined,
    isPrimary: body.isPrimary as boolean | undefined,
    effectiveAt: body.effectiveAt as number | string | null | undefined,
    expiresAt: body.expiresAt as number | string | null | undefined,
    reason: body.reason as string | null | undefined,
  };
}

function parseUpdate(req: Request): UpdateResponsibilityAssignmentCommand {
  const body = requireRecord(req.body);
  return {
    assignmentId: req.params.assignmentId,
    responsibilityRole: body.responsibilityRole as string | null | undefined,
    includeDescendants: body.includeDescendants as boolean | null | undefined,
    actionMask: body.actionMask as readonly string[] | null | undefined,
    isPrimary: body.isPrimary as boolean | undefined,
    effectiveAt: body.effectiveAt as number | string | null | undefined,
    expiresAt: body.expiresAt as number | string | null | undefined,
    reason: body.reason as string | null | undefined,
  };
}

function parseRevoke(req: Request): RevokeResponsibilityAssignmentCommand {
  const body = requireRecord(req.body);
  return {
    assignmentId: req.params.assignmentId,
    reason: body.reason as string | null | undefined,
  };
}

function parseSubjectType(value: string): ResponsibilitySubjectType {
  if (
    value === "TALENT_GROUP" ||
    value === "ORG_UNIT" ||
    value === "TALENT" ||
    value === "EMPLOYMENT_PROFILE"
  ) {
    return value;
  }
  throw new ResponsibilityValidationError("subjectType is invalid");
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
