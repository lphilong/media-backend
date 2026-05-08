import { PresenterRegistryWriter } from "@app/presenter/presenter.runtime-access";
import {
  PLATFORM_ACCOUNT_ADMIN_DETAIL_PRESENTER_KEY,
  PLATFORM_ACCOUNT_ADMIN_LIST_PRESENTER_KEY,
  PLATFORM_ACCOUNT_ADMIN_MUTATION_PRESENTER_KEY,
} from "./platform-account.presenter-keys";
import {
  PlatformAccountAdminDetailPresenter,
  PlatformAccountAdminListPresenter,
  PlatformAccountAdminMutationPresenter,
} from "./platform-account.presenter";

export function registerPresenters(
  registry: PresenterRegistryWriter,
): void {
  registry.register(
    PLATFORM_ACCOUNT_ADMIN_MUTATION_PRESENTER_KEY,
    new PlatformAccountAdminMutationPresenter(),
  );

  registry.register(
    PLATFORM_ACCOUNT_ADMIN_LIST_PRESENTER_KEY,
    new PlatformAccountAdminListPresenter(),
  );

  registry.register(
    PLATFORM_ACCOUNT_ADMIN_DETAIL_PRESENTER_KEY,
    new PlatformAccountAdminDetailPresenter(),
  );
}
