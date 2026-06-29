import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import {
  EMPLOYMENT_PROFILE_ADMIN_DETAIL_PRESENTER_KEY,
  EMPLOYMENT_PROFILE_ADMIN_LIST_PRESENTER_KEY,
} from "@modules/employment-profile/shared/employment-profile.presenter-keys";
import { EmploymentProfileValidationError } from "@modules/employment-profile/domain/employment-profile.errors";
import {
  GetEmploymentProfileDetailQuery,
  ListEmploymentProfileDirectReportsQuery,
  ListEmploymentProfilesQuery,
} from "@modules/employment-profile/shared/employment-profile.contracts";
import { EmploymentProfileAdminQueryService } from "./admin.employment-profile.query-service";

type EmploymentProfileQueryCommand =
  | "EMPLOYMENT_PROFILE_LIST"
  | "EMPLOYMENT_PROFILE_GET_DETAIL"
  | "EMPLOYMENT_PROFILE_LIST_DIRECT_REPORTS";

const LIST_EMPLOYMENT_PROFILES_ALLOWED_QUERY_KEYS =
  Object.freeze([
    "employmentStatus",
    "contractStatus",
    "employmentKind",
    "orgUnitId",
    "hasLinkedUser",
    "limit",
    "cursor",
    "search",
    "sortBy",
    "sortDirection",
  ] as const);

const LIST_EMPLOYMENT_PROFILE_DIRECT_REPORTS_ALLOWED_QUERY_KEYS =
  Object.freeze([
    "limit",
    "cursor",
    "sortBy",
    "sortDirection",
  ] as const);

export class EmploymentProfileAdminQueryController extends SecureController {
  constructor(
    private readonly service: EmploymentProfileAdminQueryService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<EmploymentProfileQueryCommand>(
        req,
      );

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Employment profile query command missing",
      );
    }

    switch (command) {
      case "EMPLOYMENT_PROFILE_LIST":
        return this.service.listEmploymentProfiles(
          actor,
          parseListEmploymentProfilesQuery(req),
        );

      case "EMPLOYMENT_PROFILE_GET_DETAIL":
        return this.service.getEmploymentProfileDetail(
          actor,
          parseGetEmploymentProfileDetailQuery(req),
        );

      case "EMPLOYMENT_PROFILE_LIST_DIRECT_REPORTS":
        return this.service.listEmploymentProfileDirectReports(
          actor,
          parseListEmploymentProfileDirectReportsQuery(
            req,
          ),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported employment profile query command: ${command}`,
        );
    }
  }

  protected async present(
    result: unknown,
    req: Request,
    _actor: Actor,
    context: ContextType,
  ): Promise<PresentationResult> {
    const command =
      readCommand<EmploymentProfileQueryCommand>(
        req,
      );

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Employment profile query command missing",
      );
    }

    const registry = getPresenterRegistryFromRequest(req);

    switch (command) {
      case "EMPLOYMENT_PROFILE_LIST":
      case "EMPLOYMENT_PROFILE_LIST_DIRECT_REPORTS":
        return registry
          .get<unknown, PresentationResult>(
            EMPLOYMENT_PROFILE_ADMIN_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "EMPLOYMENT_PROFILE_GET_DETAIL":
        return registry
          .get<unknown, PresentationResult>(
            EMPLOYMENT_PROFILE_ADMIN_DETAIL_PRESENTER_KEY,
          )
          .present(result, context);

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported employment profile query command: ${command}`,
        );
    }
  }
}

function parseListEmploymentProfilesQuery(
  req: Request,
): ListEmploymentProfilesQuery {
  const query = readQueryRecord(req);
  assertAllowedQueryKeys(
    query,
    LIST_EMPLOYMENT_PROFILES_ALLOWED_QUERY_KEYS,
    "EMPLOYMENT_PROFILE_LIST",
  );

  return {
    employmentStatus: query.employmentStatus as
        | string
        | undefined,
    contractStatus: query.contractStatus as
        | string
        | undefined,
    employmentKind: query.employmentKind as
        | string
        | undefined,
    orgUnitId: query.orgUnitId as
      | string
      | undefined,
    hasLinkedUser: query.hasLinkedUser as
        | string
        | undefined,
    limit: query.limit as string | undefined,
    cursor: query.cursor as string | undefined,
    search: query.search as string | undefined,
    sortBy: query.sortBy as string | undefined,
    sortDirection:
      query.sortDirection as
        | string
        | undefined,
  };
}

function parseGetEmploymentProfileDetailQuery(
  req: Request,
): GetEmploymentProfileDetailQuery {
  assertAllowedQueryKeys(
    readQueryRecord(req),
    [],
    "EMPLOYMENT_PROFILE_GET_DETAIL",
  );

  return {
    employmentProfileId:
      req.params.employmentProfileId,
  };
}

function parseListEmploymentProfileDirectReportsQuery(
  req: Request,
): ListEmploymentProfileDirectReportsQuery {
  const query = readQueryRecord(req);
  assertAllowedQueryKeys(
    query,
    LIST_EMPLOYMENT_PROFILE_DIRECT_REPORTS_ALLOWED_QUERY_KEYS,
    "EMPLOYMENT_PROFILE_LIST_DIRECT_REPORTS",
  );

  return {
    employmentProfileId:
      req.params.employmentProfileId,
    limit: query.limit as string | undefined,
    cursor: query.cursor as string | undefined,
    sortBy: query.sortBy as string | undefined,
    sortDirection:
      query.sortDirection as
        | string
        | undefined,
  };
}

function readQueryRecord(
  req: Request,
): Readonly<Record<string, unknown>> {
  return req.query as Record<string, unknown>;
}

function assertAllowedQueryKeys(
  query: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
  command: EmploymentProfileQueryCommand,
): void {
  const allowed = new Set(allowedKeys);
  const unsupportedKeys = Object.keys(query).filter(
    (key) => !allowed.has(key),
  );

  if (unsupportedKeys.length === 0) {
    return;
  }

  unsupportedKeys.sort();

  throw new EmploymentProfileValidationError(
    `Unsupported query parameter(s) for ${command}: ${unsupportedKeys.join(", ")}`,
  );
}
