import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import {
  TALENT_GROUP_ADMIN_BY_TALENT_LIST_PRESENTER_KEY,
  TALENT_GROUP_ADMIN_DETAIL_PRESENTER_KEY,
  TALENT_GROUP_ADMIN_LIST_PRESENTER_KEY,
  TALENT_GROUP_ADMIN_MEMBER_LIST_PRESENTER_KEY,
} from "@modules/talent-group/shared/talent-group.presenter-keys";
import {
  GetTalentGroupDetailQuery,
  ListTalentGroupMembersQuery,
  ListTalentGroupsByTalentQuery,
  ListTalentGroupsQuery,
} from "@modules/talent-group/shared/talent-group.contracts";
import { TalentGroupValidationError } from "@modules/talent-group/domain/talent-group.errors";
import { TalentGroupAdminQueryService } from "./admin.talent-group.query-service";

type TalentGroupQueryCommand =
  | "TALENT_GROUP_LIST"
  | "TALENT_GROUP_GET_DETAIL"
  | "TALENT_GROUP_LIST_MEMBERS"
  | "TALENT_GROUP_LIST_BY_TALENT";

const LIST_TALENT_GROUPS_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "status",
    "containsTalentId",
    "limit",
    "cursor",
    "search",
    "sortBy",
    "sortDirection",
  ]);

const LIST_TALENT_GROUP_MEMBERS_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "limit",
    "cursor",
  ]);

const LIST_TALENT_GROUPS_BY_TALENT_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "status",
    "limit",
    "cursor",
    "sortBy",
    "sortDirection",
  ]);

export class TalentGroupAdminQueryController extends SecureController {
  constructor(
    private readonly service: TalentGroupAdminQueryService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<TalentGroupQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Talent group query command missing",
      );
    }

    switch (command) {
      case "TALENT_GROUP_LIST":
        return this.service.listTalentGroups(
          actor,
          parseListTalentGroupsQuery(req),
        );

      case "TALENT_GROUP_GET_DETAIL":
        return this.service.getTalentGroupDetail(
          actor,
          parseGetTalentGroupDetailQuery(req),
        );

      case "TALENT_GROUP_LIST_MEMBERS":
        return this.service.listTalentGroupMembers(
          actor,
          parseListTalentGroupMembersQuery(req),
        );

      case "TALENT_GROUP_LIST_BY_TALENT":
        return this.service.listTalentGroupsByTalent(
          actor,
          parseListTalentGroupsByTalentQuery(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported talent group query command: ${command}`,
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
      readCommand<TalentGroupQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Talent group query command missing",
      );
    }

    const registry = getPresenterRegistryFromRequest(req);

    switch (command) {
      case "TALENT_GROUP_LIST":
        return registry
          .get<unknown, PresentationResult>(
            TALENT_GROUP_ADMIN_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "TALENT_GROUP_GET_DETAIL":
        return registry
          .get<unknown, PresentationResult>(
            TALENT_GROUP_ADMIN_DETAIL_PRESENTER_KEY,
          )
          .present(result, context);

      case "TALENT_GROUP_LIST_MEMBERS":
        return registry
          .get<unknown, PresentationResult>(
            TALENT_GROUP_ADMIN_MEMBER_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "TALENT_GROUP_LIST_BY_TALENT":
        return registry
          .get<unknown, PresentationResult>(
            TALENT_GROUP_ADMIN_BY_TALENT_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported talent group query command: ${command}`,
        );
    }
  }
}

function parseListTalentGroupsQuery(
  req: Request,
): ListTalentGroupsQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_TALENT_GROUPS_QUERY_FIELDS,
    "listTalentGroups",
  );

  return {
    status: req.query.status as string | undefined,
    containsTalentId:
      req.query.containsTalentId as
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

function parseGetTalentGroupDetailQuery(
  req: Request,
): GetTalentGroupDetailQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    [],
    "getTalentGroupDetail",
  );

  return {
    groupId: req.params.groupId,
  };
}

function parseListTalentGroupMembersQuery(
  req: Request,
): ListTalentGroupMembersQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_TALENT_GROUP_MEMBERS_QUERY_FIELDS,
    "listTalentGroupMembers",
  );

  return {
    groupId: req.params.groupId,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
  };
}

function parseListTalentGroupsByTalentQuery(
  req: Request,
): ListTalentGroupsByTalentQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_TALENT_GROUPS_BY_TALENT_QUERY_FIELDS,
    "listTalentGroupsByTalent",
  );

  return {
    talentId: req.params.talentId,
    status: req.query.status as string | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as
        | string
        | undefined,
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

  throw new TalentGroupValidationError(
    `${queryName} query contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
