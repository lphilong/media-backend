import { PresenterRegistryWriter } from "@app/presenter/presenter.runtime-access";
import {
  TALENT_ADMIN_DETAIL_PRESENTER_KEY,
  TALENT_ADMIN_LIST_PRESENTER_KEY,
  TALENT_ADMIN_MUTATION_PRESENTER_KEY,
} from "./talent.presenter-keys";
import {
  TalentAdminDetailPresenter,
  TalentAdminListPresenter,
  TalentAdminMutationPresenter,
} from "./talent.presenter";

export function registerPresenters(
  registry: PresenterRegistryWriter,
): void {
  registry.register(
    TALENT_ADMIN_MUTATION_PRESENTER_KEY,
    new TalentAdminMutationPresenter(),
  );

  registry.register(
    TALENT_ADMIN_LIST_PRESENTER_KEY,
    new TalentAdminListPresenter(),
  );

  registry.register(
    TALENT_ADMIN_DETAIL_PRESENTER_KEY,
    new TalentAdminDetailPresenter(),
  );
}
