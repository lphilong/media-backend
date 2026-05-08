import { PresenterRegistryWriter } from "@app/presenter/presenter.runtime-access";
import {
  EMPLOYMENT_PROFILE_ADMIN_DETAIL_PRESENTER_KEY,
  EMPLOYMENT_PROFILE_ADMIN_LIST_PRESENTER_KEY,
  EMPLOYMENT_PROFILE_ADMIN_MUTATION_PRESENTER_KEY,
} from "./employment-profile.presenter-keys";
import {
  EmploymentProfileAdminDetailPresenter,
  EmploymentProfileAdminListPresenter,
  EmploymentProfileAdminMutationPresenter,
} from "./employment-profile.presenter";

export function registerPresenters(
  registry: PresenterRegistryWriter,
): void {
  registry.register(
    EMPLOYMENT_PROFILE_ADMIN_MUTATION_PRESENTER_KEY,
    new EmploymentProfileAdminMutationPresenter(),
  );

  registry.register(
    EMPLOYMENT_PROFILE_ADMIN_LIST_PRESENTER_KEY,
    new EmploymentProfileAdminListPresenter(),
  );

  registry.register(
    EMPLOYMENT_PROFILE_ADMIN_DETAIL_PRESENTER_KEY,
    new EmploymentProfileAdminDetailPresenter(),
  );
}
