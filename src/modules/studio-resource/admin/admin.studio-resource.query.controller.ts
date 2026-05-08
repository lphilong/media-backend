import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { StudioResourceValidationError } from "@modules/studio-resource/domain/studio-resource.errors";
import {
  STUDIO_RESOURCE_ADMIN_AVAILABILITY_LIST_PRESENTER_KEY,
  STUDIO_RESOURCE_ADMIN_DETAIL_PRESENTER_KEY,
  STUDIO_RESOURCE_ADMIN_LIST_PRESENTER_KEY,
} from "@modules/studio-resource/shared/studio-resource.presenter-keys";
import {
  GetStudioResourceDetailQuery,
  ListStudioResourceAvailabilityQuery,
  ListStudioResourcesQuery,
} from "@modules/studio-resource/shared/studio-resource.contracts";
import { StudioResourceAdminQueryService } from "./admin.studio-resource.query-service";

type StudioResourceQueryCommand =
  | "STUDIO_RESOURCE_LIST"
  | "STUDIO_RESOURCE_LIST_AVAILABILITY"
  | "STUDIO_RESOURCE_GET_DETAIL";

const LIST_STUDIO_RESOURCES_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "resourceClass",
    "operationalStatus",
    "hasMaxOccupancy",
    "limit",
    "cursor",
    "search",
    "sortBy",
    "sortDirection",
  ]);

export class StudioResourceAdminQueryController extends SecureController {
  constructor(
    private readonly service: StudioResourceAdminQueryService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<StudioResourceQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Studio resource query command missing",
      );
    }

    switch (command) {
      case "STUDIO_RESOURCE_LIST":
        return this.service.listStudioResources(
          actor,
          parseListStudioResourcesQuery(req),
        );

      case "STUDIO_RESOURCE_LIST_AVAILABILITY":
        return this.service.listStudioResourceAvailability(
          actor,
          parseListStudioResourceAvailabilityQuery(
            req,
          ),
        );

      case "STUDIO_RESOURCE_GET_DETAIL":
        return this.service.getStudioResourceDetail(
          actor,
          parseGetStudioResourceDetailQuery(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported studio resource query command: ${command}`,
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
      readCommand<StudioResourceQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Studio resource query command missing",
      );
    }

    const registry = getPresenterRegistryFromRequest(req);

    switch (command) {
      case "STUDIO_RESOURCE_LIST":
        return registry
          .get<unknown, PresentationResult>(
            STUDIO_RESOURCE_ADMIN_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "STUDIO_RESOURCE_LIST_AVAILABILITY":
        return registry
          .get<unknown, PresentationResult>(
            STUDIO_RESOURCE_ADMIN_AVAILABILITY_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "STUDIO_RESOURCE_GET_DETAIL":
        return registry
          .get<unknown, PresentationResult>(
            STUDIO_RESOURCE_ADMIN_DETAIL_PRESENTER_KEY,
          )
          .present(result, context);

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported studio resource query command: ${command}`,
        );
    }
  }
}

function parseListStudioResourcesQuery(
  req: Request,
): ListStudioResourcesQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_STUDIO_RESOURCES_QUERY_FIELDS,
    "listStudioResources",
  );

  return {
    resourceClass:
      req.query.resourceClass as string | undefined,
    operationalStatus:
      req.query.operationalStatus as
        | string
        | undefined,
    hasMaxOccupancy:
      req.query.hasMaxOccupancy as
        | string
        | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    search: req.query.search as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as string | undefined,
  };
}

function parseListStudioResourceAvailabilityQuery(
  req: Request,
): ListStudioResourceAvailabilityQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_STUDIO_RESOURCES_QUERY_FIELDS,
    "listStudioResourceAvailability",
  );

  return {
    resourceClass:
      req.query.resourceClass as string | undefined,
    operationalStatus:
      req.query.operationalStatus as
        | string
        | undefined,
    hasMaxOccupancy:
      req.query.hasMaxOccupancy as
        | string
        | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    search: req.query.search as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as string | undefined,
  };
}

function parseGetStudioResourceDetailQuery(
  req: Request,
): GetStudioResourceDetailQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    [],
    "getStudioResourceDetail",
  );

  return {
    studioResourceId: req.params.studioResourceId,
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

  throw new StudioResourceValidationError(
    `${queryName} query contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
