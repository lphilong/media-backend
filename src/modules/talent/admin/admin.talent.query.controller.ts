import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import {
  TALENT_ADMIN_DETAIL_PRESENTER_KEY,
  TALENT_ADMIN_LIST_PRESENTER_KEY,
} from "@modules/talent/shared/talent.presenter-keys";
import {
  GetTalentDetailQuery,
  ListTalentsQuery,
} from "@modules/talent/shared/talent.contracts";
import { TalentValidationError } from "@modules/talent/domain/talent.errors";
import { TalentAdminQueryService } from "./admin.talent.query-service";

type TalentQueryCommand =
  | "TALENT_LIST"
  | "TALENT_GET_DETAIL";

const LIST_TALENTS_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "operationalStatus",
    "talentOrigin",
    "managerEmploymentProfileId",
    "hasLinkedEmploymentProfile",
    "commercialParticipationStatus",
    "livestreamEligible",
    "eventEligible",
    "limit",
    "cursor",
    "search",
    "sortBy",
    "sortDirection",
  ]);

const GET_TALENT_DETAIL_QUERY_FIELDS: readonly string[] =
  Object.freeze([]);

export class TalentAdminQueryController extends SecureController {
  constructor(
    private readonly service: TalentAdminQueryService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command = readCommand<TalentQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Talent query command missing",
      );
    }

    switch (command) {
      case "TALENT_LIST":
        return this.service.listTalents(
          actor,
          parseListTalentsQuery(req),
        );

      case "TALENT_GET_DETAIL":
        return this.service.getTalentDetail(
          actor,
          parseGetTalentDetailQuery(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported talent query command: ${command}`,
        );
    }
  }

  protected async present(
    result: unknown,
    req: Request,
    _actor: Actor,
    context: ContextType,
  ): Promise<PresentationResult> {
    const command = readCommand<TalentQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Talent query command missing",
      );
    }

    const registry = getPresenterRegistryFromRequest(req);

    switch (command) {
      case "TALENT_LIST":
        return registry
          .get<unknown, PresentationResult>(
            TALENT_ADMIN_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "TALENT_GET_DETAIL":
        return registry
          .get<unknown, PresentationResult>(
            TALENT_ADMIN_DETAIL_PRESENTER_KEY,
          )
          .present(result, context);

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported talent query command: ${command}`,
        );
    }
  }
}

function parseListTalentsQuery(
  req: Request,
): ListTalentsQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_TALENTS_QUERY_FIELDS,
    "listTalents",
  );

  return {
    operationalStatus:
      req.query.operationalStatus as
        | string
        | undefined,
    talentOrigin:
      req.query.talentOrigin as string | undefined,
    managerEmploymentProfileId:
      req.query.managerEmploymentProfileId as
        | string
        | undefined,
    hasLinkedEmploymentProfile:
      req.query.hasLinkedEmploymentProfile as
        | string
        | undefined,
    commercialParticipationStatus:
      req.query
        .commercialParticipationStatus as
        | string
        | undefined,
    livestreamEligible:
      req.query.livestreamEligible as
        | string
        | undefined,
    eventEligible:
      req.query.eventEligible as
        | string
        | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    search: req.query.search as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as
        | string
        | undefined,
  };
}

function parseGetTalentDetailQuery(
  req: Request,
): GetTalentDetailQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    GET_TALENT_DETAIL_QUERY_FIELDS,
    "getTalentDetail",
  );

  return {
    talentId: req.params.talentId,
  };
}

function assertNoUnexpectedQueryFields(
  query: Record<string, unknown>,
  allowedFields: readonly string[],
  queryName: string,
): void {
  const unexpectedFields = Object.keys(query).filter(
    (field) => !allowedFields.includes(field),
  );

  if (unexpectedFields.length === 0) {
    return;
  }

  throw new TalentValidationError(
    `${queryName} query contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
