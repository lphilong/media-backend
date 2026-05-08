import { PresenterRegistryWriter } from "@app/presenter/presenter.runtime-access";
import {
  USER_ADMIN_DETAIL_PRESENTER_KEY,
  USER_ADMIN_LIST_PRESENTER_KEY,
  USER_ADMIN_MUTATION_PRESENTER_KEY,
} from "./user.presenter-keys";
import {
  UserAdminDetailPresenter,
  UserAdminListPresenter,
  UserAdminMutationPresenter,
} from "./user.presenter";

export function registerPresenters(
  registry: PresenterRegistryWriter,
): void {
  registry.register(
    USER_ADMIN_MUTATION_PRESENTER_KEY,
    new UserAdminMutationPresenter(),
  );

  registry.register(
    USER_ADMIN_LIST_PRESENTER_KEY,
    new UserAdminListPresenter(),
  );

  registry.register(
    USER_ADMIN_DETAIL_PRESENTER_KEY,
    new UserAdminDetailPresenter(),
  );
}
