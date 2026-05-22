import { PresenterRegistryWriter } from "@app/presenter/presenter.runtime-access";
import {
  KPI_ADMIN_ACTUAL_GRID_PRESENTER_KEY,
  KPI_ADMIN_CORRECTION_LIST_PRESENTER_KEY,
  KPI_ADMIN_DETAIL_PRESENTER_KEY,
  KPI_ADMIN_LIST_PRESENTER_KEY,
  KPI_ADMIN_MUTATION_PRESENTER_KEY,
  KPI_ADMIN_PROGRESS_PRESENTER_KEY,
} from "./kpi.presenter-keys";
import {
  KpiAdminActualGridPresenter,
  KpiAdminCorrectionListPresenter,
  KpiAdminDetailPresenter,
  KpiAdminListPresenter,
  KpiAdminMutationPresenter,
  KpiAdminProgressPresenter,
} from "./kpi.presenter";

export function registerPresenters(
  registry: PresenterRegistryWriter,
): void {
  registry.register(
    KPI_ADMIN_MUTATION_PRESENTER_KEY,
    new KpiAdminMutationPresenter(),
  );
  registry.register(
    KPI_ADMIN_LIST_PRESENTER_KEY,
    new KpiAdminListPresenter(),
  );
  registry.register(
    KPI_ADMIN_DETAIL_PRESENTER_KEY,
    new KpiAdminDetailPresenter(),
  );
  registry.register(
    KPI_ADMIN_PROGRESS_PRESENTER_KEY,
    new KpiAdminProgressPresenter(),
  );
  registry.register(
    KPI_ADMIN_ACTUAL_GRID_PRESENTER_KEY,
    new KpiAdminActualGridPresenter(),
  );
  registry.register(
    KPI_ADMIN_CORRECTION_LIST_PRESENTER_KEY,
    new KpiAdminCorrectionListPresenter(),
  );
}
