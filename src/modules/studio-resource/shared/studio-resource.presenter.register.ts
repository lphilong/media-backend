import { PresenterRegistryWriter } from "@app/presenter/presenter.runtime-access";
import {
  STUDIO_RESOURCE_ADMIN_AVAILABILITY_LIST_PRESENTER_KEY,
  STUDIO_RESOURCE_ADMIN_DETAIL_PRESENTER_KEY,
  STUDIO_RESOURCE_ADMIN_LIST_PRESENTER_KEY,
  STUDIO_RESOURCE_ADMIN_MUTATION_PRESENTER_KEY,
} from "./studio-resource.presenter-keys";
import {
  StudioResourceAdminAvailabilityListPresenter,
  StudioResourceAdminDetailPresenter,
  StudioResourceAdminListPresenter,
  StudioResourceAdminMutationPresenter,
} from "./studio-resource.presenter";

export function registerPresenters(
  registry: PresenterRegistryWriter,
): void {
  registry.register(
    STUDIO_RESOURCE_ADMIN_MUTATION_PRESENTER_KEY,
    new StudioResourceAdminMutationPresenter(),
  );

  registry.register(
    STUDIO_RESOURCE_ADMIN_LIST_PRESENTER_KEY,
    new StudioResourceAdminListPresenter(),
  );

  registry.register(
    STUDIO_RESOURCE_ADMIN_AVAILABILITY_LIST_PRESENTER_KEY,
    new StudioResourceAdminAvailabilityListPresenter(),
  );

  registry.register(
    STUDIO_RESOURCE_ADMIN_DETAIL_PRESENTER_KEY,
    new StudioResourceAdminDetailPresenter(),
  );
}
