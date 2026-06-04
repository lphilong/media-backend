import { PresenterRegistryWriter } from "@app/presenter/presenter.runtime-access";
import {
  ORG_UNIT_ADMIN_DETAIL_PRESENTER_KEY,
  ORG_UNIT_ADMIN_LIST_PRESENTER_KEY,
  ORG_UNIT_ADMIN_MUTATION_PRESENTER_KEY,
  ORG_UNIT_ADMIN_RESPONSIBILITY_LIST_PRESENTER_KEY,
} from "./org-unit.presenter-keys";
import {
  OrgUnitAdminDetailPresenter,
  OrgUnitAdminListPresenter,
  OrgUnitAdminMutationPresenter,
  OrgUnitResponsibilityListPresenter,
} from "./org-unit.presenter";

export function registerPresenters(
  registry: PresenterRegistryWriter,
): void {
  registry.register(
    ORG_UNIT_ADMIN_MUTATION_PRESENTER_KEY,
    new OrgUnitAdminMutationPresenter(),
  );

  registry.register(
    ORG_UNIT_ADMIN_LIST_PRESENTER_KEY,
    new OrgUnitAdminListPresenter(),
  );

  registry.register(
    ORG_UNIT_ADMIN_DETAIL_PRESENTER_KEY,
    new OrgUnitAdminDetailPresenter(),
  );

  registry.register(
    ORG_UNIT_ADMIN_RESPONSIBILITY_LIST_PRESENTER_KEY,
    new OrgUnitResponsibilityListPresenter(),
  );
}
