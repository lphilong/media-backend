import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { PresentationResult, toPlainObject } from "@app/base/presentation-result.types";
import { SecureController } from "@app/base/secure-controller.base";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { PeopleReadinessValidationError } from "../domain/people-readiness.errors";
import { ListPeopleReadinessIssuesQuery } from "../shared/people-readiness.contracts";
import { PeopleReadinessAdminService } from "./admin.people-readiness.service";

type Command = "PEOPLE_READINESS_GET_SUMMARY" | "PEOPLE_READINESS_LIST_ISSUES";
const ALLOWED_ISSUE_QUERY_KEYS = ["category", "issueCode", "severity", "entityType", "cursor", "limit"] as const;

export class PeopleReadinessAdminController extends SecureController {
  constructor(private readonly service: PeopleReadinessAdminService) {
    super();
  }

  protected async handle(req: Request, actor: Actor, _context: ContextType): Promise<unknown> {
    const command = readCommand<Command>(req);
    if (command === "PEOPLE_READINESS_GET_SUMMARY") {
      assertAllowedKeys(req, []);
      return this.service.getSummary(actor);
    }
    if (command === "PEOPLE_READINESS_LIST_ISSUES") {
      assertAllowedKeys(req, ALLOWED_ISSUE_QUERY_KEYS);
      return this.service.listIssues(actor, req.query as ListPeopleReadinessIssuesQuery);
    }
    throw new SystemInvariantError("SYSTEM_INVARIANT_VIOLATION", "People Readiness command missing or unsupported");
  }

  protected async present(result: unknown): Promise<PresentationResult> {
    return { data: toPlainObject(result, "People Readiness result") };
  }
}

function assertAllowedKeys(req: Request, allowedKeys: readonly string[]): void {
  const allowed = new Set(allowedKeys);
  const unsupported = Object.keys(req.query).filter((key) => !allowed.has(key)).sort();
  if (unsupported.length > 0) {
    throw new PeopleReadinessValidationError(`Unsupported query parameter(s): ${unsupported.join(", ")}`);
  }
}
