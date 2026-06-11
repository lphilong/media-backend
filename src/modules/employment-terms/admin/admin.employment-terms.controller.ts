import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { PresentationResult, toPlainObject } from "@app/base/presentation-result.types";
import { SecureController } from "@app/base/secure-controller.base";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { EmploymentTermsValidationError } from "../domain/employment-terms.errors";
import { EmploymentTermsAdminService } from "./admin.employment-terms.service";

type Command =
  | "EMPLOYMENT_TERMS_ADMIN_LIST"
  | "EMPLOYMENT_TERMS_LIST"
  | "EMPLOYMENT_TERMS_GET"
  | "EMPLOYMENT_TERMS_CREATE"
  | "EMPLOYMENT_TERMS_UPDATE"
  | "EMPLOYMENT_TERMS_SUBMIT"
  | "EMPLOYMENT_TERMS_APPROVE"
  | "EMPLOYMENT_TERMS_CANCEL";

const MUTABLE_FIELDS = [
  "effectiveFrom",
  "effectiveTo",
  "baseSalaryAmount",
  "currencyCode",
  "payFrequency",
  "allowances",
  "payrollEligible",
  "sourceNote",
] as const;

const ADMIN_LIST_QUERY_FIELDS = [
  "employmentProfileId",
  "orgUnitId",
  "employmentStatus",
  "status",
  "payrollEligible",
  "effectiveOn",
  "expiringBefore",
  "readiness",
  "search",
  "cursor",
  "limit",
] as const;

export class EmploymentTermsAdminController extends SecureController {
  constructor(private readonly service: EmploymentTermsAdminService) {
    super();
  }

  protected async handle(req: Request, actor: Actor, _context: ContextType): Promise<unknown> {
    const command = readCommand<Command>(req);
    const employmentProfileId = req.params.employmentProfileId;
    const termsId = req.params.termsId;
    switch (command) {
      case "EMPLOYMENT_TERMS_ADMIN_LIST":
        assertBodyAndQuery(req, [], ADMIN_LIST_QUERY_FIELDS);
        return this.service.listAllProfiles(actor, req.query as never);
      case "EMPLOYMENT_TERMS_LIST":
        assertBodyAndQuery(req, [], []);
        return this.service.list(actor, employmentProfileId);
      case "EMPLOYMENT_TERMS_GET":
        assertBodyAndQuery(req, [], []);
        return this.service.get(actor, { employmentProfileId, termsId });
      case "EMPLOYMENT_TERMS_CREATE":
        assertBodyAndQuery(req, MUTABLE_FIELDS, []);
        return this.service.create(actor, { employmentProfileId, ...requireBody(req.body) } as never);
      case "EMPLOYMENT_TERMS_UPDATE":
        assertBodyAndQuery(req, MUTABLE_FIELDS, []);
        return this.service.update(actor, { employmentProfileId, termsId, ...requireBody(req.body) } as never);
      case "EMPLOYMENT_TERMS_SUBMIT":
        assertBodyAndQuery(req, [], []);
        return this.service.submit(actor, { employmentProfileId, termsId });
      case "EMPLOYMENT_TERMS_APPROVE":
        assertBodyAndQuery(req, [], []);
        return this.service.approve(actor, { employmentProfileId, termsId });
      case "EMPLOYMENT_TERMS_CANCEL":
        assertBodyAndQuery(req, [], []);
        return this.service.cancel(actor, { employmentProfileId, termsId });
      default:
        throw new SystemInvariantError("SYSTEM_INVARIANT_VIOLATION", "Employment terms command missing or unsupported");
    }
  }

  protected async present(result: unknown): Promise<PresentationResult> {
    if (Array.isArray(result)) {
      return {
        data: result.map((item) =>
          toPlainObject(item, "Employment terms list item"),
        ),
      };
    }
    return { data: toPlainObject(result, "Employment terms result") };
  }
}

function assertBodyAndQuery(req: Request, allowedBody: readonly string[], allowedQuery: readonly string[]): void {
  const body = requireBody(req.body);
  const unsupportedBody = Object.keys(body).filter((key) => !allowedBody.includes(key)).sort();
  const unsupportedQuery = Object.keys(req.query).filter((key) => !allowedQuery.includes(key)).sort();
  if (unsupportedBody.length > 0) {
    throw new EmploymentTermsValidationError(`Unsupported body field(s): ${unsupportedBody.join(", ")}`);
  }
  if (unsupportedQuery.length > 0) {
    throw new EmploymentTermsValidationError(`Unsupported query parameter(s): ${unsupportedQuery.join(", ")}`);
  }
}

function requireBody(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new EmploymentTermsValidationError("Request body must be a plain object");
  }
  return value as Record<string, unknown>;
}
