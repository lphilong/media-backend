import { PresentationResult } from "@app/base/presentation-result.types";
import { Presenter } from "@app/presenter/presenter.base";
import { ContextType } from "@core/context/context.types";
import { GetDashboardLiteSnapshotResult } from "./dashboard-lite.contracts";
import { DashboardLiteAdminSnapshotExposure } from "./dashboard-lite.exposure";

export class DashboardLiteAdminSnapshotPresenter extends Presenter<
  GetDashboardLiteSnapshotResult,
  PresentationResult
> {
  present(
    input: GetDashboardLiteSnapshotResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        DashboardLiteAdminSnapshotExposure.expose(
          input,
        ),
    };
  }
}
