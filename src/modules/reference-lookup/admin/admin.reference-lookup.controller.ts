import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { PresentationResult } from "@app/base/presentation-result.types";
import { SecureController } from "@app/base/secure-controller.base";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { ReferenceLookupValidationError } from "@modules/reference-lookup/domain/reference-lookup.errors";
import {
  ReferenceLookupDomain,
  ReferenceLookupResult,
} from "@modules/reference-lookup/shared/reference-lookup.contracts";
import { ReferenceLookupAdminService } from "./admin.reference-lookup.service";

type ReferenceLookupCommand =
  | "REFERENCE_LOOKUP_ORG_UNITS"
  | "REFERENCE_LOOKUP_EMPLOYMENT_PROFILES"
  | "REFERENCE_LOOKUP_TALENTS"
  | "REFERENCE_LOOKUP_TALENT_GROUPS"
  | "REFERENCE_LOOKUP_PLATFORM_ACCOUNTS"
  | "REFERENCE_LOOKUP_STUDIO_RESOURCES"
  | "REFERENCE_LOOKUP_EVENTS"
  | "REFERENCE_LOOKUP_CONTRACT_RECORDS"
  | "REFERENCE_LOOKUP_REVENUE_ENTRIES"
  | "REFERENCE_LOOKUP_COMMISSION_RULES";

const QUERY_FIELDS = Object.freeze(["search", "ids", "limit"]);

const DOMAIN_BY_COMMAND: Readonly<
  Record<ReferenceLookupCommand, ReferenceLookupDomain>
> = Object.freeze({
  REFERENCE_LOOKUP_ORG_UNITS: "orgUnits",
  REFERENCE_LOOKUP_EMPLOYMENT_PROFILES: "employmentProfiles",
  REFERENCE_LOOKUP_TALENTS: "talents",
  REFERENCE_LOOKUP_TALENT_GROUPS: "talentGroups",
  REFERENCE_LOOKUP_PLATFORM_ACCOUNTS: "platformAccounts",
  REFERENCE_LOOKUP_STUDIO_RESOURCES: "studioResources",
  REFERENCE_LOOKUP_EVENTS: "events",
  REFERENCE_LOOKUP_CONTRACT_RECORDS: "contractRecords",
  REFERENCE_LOOKUP_REVENUE_ENTRIES: "revenueEntries",
  REFERENCE_LOOKUP_COMMISSION_RULES: "commissionRules",
});

export class ReferenceLookupAdminController extends SecureController {
  constructor(private readonly service: ReferenceLookupAdminService) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<ReferenceLookupResult> {
    const command = readCommand<ReferenceLookupCommand>(req);
    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Reference lookup command missing",
      );
    }

    assertNoUnexpectedQueryFields(req.query as Record<string, unknown>);

    return this.service.listReferenceOptions(actor, {
      domain: DOMAIN_BY_COMMAND[command],
      search: req.query.search as string | undefined,
      ids: req.query.ids as string | string[] | undefined,
      limit: req.query.limit as string | undefined,
    });
  }

  protected async present(
    result: ReferenceLookupResult,
    _req: Request,
    _actor: Actor,
    _context: ContextType,
  ): Promise<PresentationResult> {
    return {
      data: {
        items: result.items.map((item) => ({
          ...item,
        })),
      },
    };
  }
}

function assertNoUnexpectedQueryFields(query: Record<string, unknown>): void {
  const unexpectedFields = Object.keys(query).filter(
    (field) => !QUERY_FIELDS.includes(field),
  );

  if (unexpectedFields.length === 0) {
    return;
  }

  throw new ReferenceLookupValidationError(
    `reference lookup query contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
