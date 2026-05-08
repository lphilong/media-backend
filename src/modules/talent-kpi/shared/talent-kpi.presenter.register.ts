import { PresenterRegistryWriter } from "@app/presenter/presenter.runtime-access";
import {
  TALENT_KPI_ADMIN_BY_EVENT_LIST_PRESENTER_KEY,
  TALENT_KPI_ADMIN_BY_PLATFORM_LIST_PRESENTER_KEY,
  TALENT_KPI_ADMIN_BY_TALENT_LIST_PRESENTER_KEY,
  TALENT_KPI_ADMIN_DETAIL_PRESENTER_KEY,
  TALENT_KPI_ADMIN_LIST_PRESENTER_KEY,
  TALENT_KPI_ADMIN_METRIC_LIST_PRESENTER_KEY,
  TALENT_KPI_ADMIN_MUTATION_PRESENTER_KEY,
} from "./talent-kpi.presenter-keys";
import {
  TalentKpiAdminByEventListPresenter,
  TalentKpiAdminByPlatformListPresenter,
  TalentKpiAdminByTalentListPresenter,
  TalentKpiAdminDetailPresenter,
  TalentKpiAdminListPresenter,
  TalentKpiAdminMetricListPresenter,
  TalentKpiAdminMutationPresenter,
} from "./talent-kpi.presenter";

export function registerPresenters(
  registry: PresenterRegistryWriter,
): void {
  registry.register(
    TALENT_KPI_ADMIN_MUTATION_PRESENTER_KEY,
    new TalentKpiAdminMutationPresenter(),
  );

  registry.register(
    TALENT_KPI_ADMIN_LIST_PRESENTER_KEY,
    new TalentKpiAdminListPresenter(),
  );

  registry.register(
    TALENT_KPI_ADMIN_METRIC_LIST_PRESENTER_KEY,
    new TalentKpiAdminMetricListPresenter(),
  );

  registry.register(
    TALENT_KPI_ADMIN_BY_TALENT_LIST_PRESENTER_KEY,
    new TalentKpiAdminByTalentListPresenter(),
  );

  registry.register(
    TALENT_KPI_ADMIN_BY_PLATFORM_LIST_PRESENTER_KEY,
    new TalentKpiAdminByPlatformListPresenter(),
  );

  registry.register(
    TALENT_KPI_ADMIN_BY_EVENT_LIST_PRESENTER_KEY,
    new TalentKpiAdminByEventListPresenter(),
  );

  registry.register(
    TALENT_KPI_ADMIN_DETAIL_PRESENTER_KEY,
    new TalentKpiAdminDetailPresenter(),
  );
}
