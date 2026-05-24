import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { TalentGroupValidationError } from "@modules/talent-group/domain/talent-group.errors";
import {
  TALENT_GROUP_ADMIN_MANAGER_ASSIGNMENT_LIST_PRESENTER_KEY,
  TALENT_GROUP_ADMIN_MUTATION_PRESENTER_KEY,
} from "@modules/talent-group/shared/talent-group.presenter-keys";
import {
  CreateTalentGroupManagerAssignmentCommand,
  RevokeTalentGroupManagerAssignmentCommand,
} from "@modules/talent-group/shared/talent-group.contracts";
import { TalentGroupManagerAssignmentAdminService } from "./admin.talent-group-manager-assignment.service";

type TalentGroupManagerAssignmentCommand =
  | "TALENT_GROUP_MANAGER_ASSIGNMENT_LIST"
  | "TALENT_GROUP_MANAGER_ASSIGNMENT_CREATE"
  | "TALENT_GROUP_MANAGER_ASSIGNMENT_REVOKE";

const CREATE_MANAGER_ASSIGNMENT_BODY_FIELDS: readonly string[] = Object.freeze([
  "managerEmploymentProfileId",
  "reason",
]);

const REVOKE_MANAGER_ASSIGNMENT_BODY_FIELDS: readonly string[] = Object.freeze([
  "reason",
]);

export class TalentGroupManagerAssignmentAdminController extends SecureController {
  constructor(
    private readonly service: TalentGroupManagerAssignmentAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command = readCommand<TalentGroupManagerAssignmentCommand>(req);
    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Talent group manager assignment command missing",
      );
    }

    switch (command) {
      case "TALENT_GROUP_MANAGER_ASSIGNMENT_LIST":
        assertNoUnexpectedFields(
          req.query as Record<string, unknown>,
          [],
          "listTalentGroupManagerAssignments",
        );
        return this.service.listManagerAssignments(actor, {
          groupId: req.params.groupId,
        });

      case "TALENT_GROUP_MANAGER_ASSIGNMENT_CREATE":
        return this.service.createManagerAssignment(
          actor,
          parseCreateManagerAssignmentCommand(req),
        );

      case "TALENT_GROUP_MANAGER_ASSIGNMENT_REVOKE":
        return this.service.revokeManagerAssignment(
          actor,
          parseRevokeManagerAssignmentCommand(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported talent group manager assignment command: ${command}`,
        );
    }
  }

  protected async present(
    result: unknown,
    req: Request,
    _actor: Actor,
    context: ContextType,
  ): Promise<PresentationResult> {
    const command = readCommand<TalentGroupManagerAssignmentCommand>(req);
    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Talent group manager assignment command missing",
      );
    }

    const key =
      command === "TALENT_GROUP_MANAGER_ASSIGNMENT_LIST"
        ? TALENT_GROUP_ADMIN_MANAGER_ASSIGNMENT_LIST_PRESENTER_KEY
        : TALENT_GROUP_ADMIN_MUTATION_PRESENTER_KEY;

    return getPresenterRegistryFromRequest(req)
      .get<unknown, PresentationResult>(key)
      .present(result, context);
  }
}

function parseCreateManagerAssignmentCommand(
  req: Request,
): CreateTalentGroupManagerAssignmentCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CREATE_MANAGER_ASSIGNMENT_BODY_FIELDS,
    "createTalentGroupManagerAssignment",
  );
  return {
    groupId: req.params.groupId,
    managerEmploymentProfileId: body.managerEmploymentProfileId as string,
    reason: body.reason as string | null | undefined,
  };
}

function parseRevokeManagerAssignmentCommand(
  req: Request,
): RevokeTalentGroupManagerAssignmentCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    REVOKE_MANAGER_ASSIGNMENT_BODY_FIELDS,
    "revokeTalentGroupManagerAssignment",
  );
  return {
    groupId: req.params.groupId,
    assignmentId: req.params.assignmentId,
    reason: body.reason as string | null | undefined,
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TalentGroupValidationError("Request body must be a plain object");
  }
  return value as Record<string, unknown>;
}

function assertNoUnexpectedFields(
  body: Record<string, unknown>,
  allowedFields: readonly string[],
  operation: string,
): void {
  const unexpectedFields = Object.keys(body).filter(
    (field) => !allowedFields.includes(field),
  );
  if (unexpectedFields.length > 0) {
    throw new TalentGroupValidationError(
      `${operation} payload contains unsupported field(s): ${unexpectedFields.join(", ")}`,
    );
  }
}
