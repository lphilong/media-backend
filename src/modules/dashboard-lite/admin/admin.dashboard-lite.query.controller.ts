import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { DashboardLiteValidationError } from "@modules/dashboard-lite/domain/dashboard-lite.errors";
import { DASHBOARD_LITE_ADMIN_SNAPSHOT_PRESENTER_KEY } from "@modules/dashboard-lite/shared/dashboard-lite.presenter-keys";
import { GetDashboardLiteSnapshotQuery } from "@modules/dashboard-lite/shared/dashboard-lite.contracts";
import { DashboardLiteAdminQueryService } from "./admin.dashboard-lite.query-service";

type DashboardLiteQueryCommand =
  "DASHBOARD_LITE_GET_SNAPSHOT";

const GET_DASHBOARD_LITE_SNAPSHOT_QUERY_FIELDS: readonly string[] =
  Object.freeze([]);

export class DashboardLiteAdminQueryController extends SecureController {
  constructor(
    private readonly service: DashboardLiteAdminQueryService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<DashboardLiteQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Dashboard Lite query command missing",
      );
    }

    switch (command) {
      case "DASHBOARD_LITE_GET_SNAPSHOT":
        return this.service.getDashboardLiteSnapshot(
          actor,
          parseGetDashboardLiteSnapshotQuery(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported Dashboard Lite query command: ${command}`,
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
      readCommand<DashboardLiteQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Dashboard Lite query command missing",
      );
    }

    const registry = getPresenterRegistryFromRequest(req);

    switch (command) {
      case "DASHBOARD_LITE_GET_SNAPSHOT":
        return registry
          .get<unknown, PresentationResult>(
            DASHBOARD_LITE_ADMIN_SNAPSHOT_PRESENTER_KEY,
          )
          .present(result, context);

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported Dashboard Lite query command: ${command}`,
        );
    }
  }
}

function parseGetDashboardLiteSnapshotQuery(
  req: Request,
): GetDashboardLiteSnapshotQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    GET_DASHBOARD_LITE_SNAPSHOT_QUERY_FIELDS,
    "getDashboardLiteSnapshot",
  );

  return {};
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

  throw new DashboardLiteValidationError(
    `${queryName} query contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
