import { PresenterRegistryWriter } from "@app/presenter/presenter.runtime-access";
import { DASHBOARD_LITE_ADMIN_SNAPSHOT_PRESENTER_KEY } from "./dashboard-lite.presenter-keys";
import { DashboardLiteAdminSnapshotPresenter } from "./dashboard-lite.presenter";

export function registerPresenters(
  registry: PresenterRegistryWriter,
): void {
  registry.register(
    DASHBOARD_LITE_ADMIN_SNAPSHOT_PRESENTER_KEY,
    new DashboardLiteAdminSnapshotPresenter(),
  );
}
