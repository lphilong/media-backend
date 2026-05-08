import { PresenterRegistryWriter } from "@app/presenter/presenter.runtime-access";
import {
  EVENT_ASSIGNMENT_ADMIN_ASSIGNMENT_LIST_PRESENTER_KEY,
  EVENT_ASSIGNMENT_ADMIN_BY_ASSIGNMENT_LIST_PRESENTER_KEY,
  EVENT_ASSIGNMENT_ADMIN_BY_PLATFORM_LIST_PRESENTER_KEY,
  EVENT_ASSIGNMENT_ADMIN_BY_RESOURCE_LIST_PRESENTER_KEY,
  EVENT_ASSIGNMENT_ADMIN_DETAIL_PRESENTER_KEY,
  EVENT_ASSIGNMENT_ADMIN_LIST_PRESENTER_KEY,
  EVENT_ASSIGNMENT_ADMIN_MUTATION_PRESENTER_KEY,
} from "./event-assignment.presenter-keys";
import {
  EventAssignmentAdminAssignmentListPresenter,
  EventAssignmentAdminByAssignmentListPresenter,
  EventAssignmentAdminByPlatformListPresenter,
  EventAssignmentAdminByResourceListPresenter,
  EventAssignmentAdminDetailPresenter,
  EventAssignmentAdminListPresenter,
  EventAssignmentAdminMutationPresenter,
} from "./event-assignment.presenter";

export function registerPresenters(
  registry: PresenterRegistryWriter,
): void {
  registry.register(
    EVENT_ASSIGNMENT_ADMIN_MUTATION_PRESENTER_KEY,
    new EventAssignmentAdminMutationPresenter(),
  );

  registry.register(
    EVENT_ASSIGNMENT_ADMIN_LIST_PRESENTER_KEY,
    new EventAssignmentAdminListPresenter(),
  );

  registry.register(
    EVENT_ASSIGNMENT_ADMIN_ASSIGNMENT_LIST_PRESENTER_KEY,
    new EventAssignmentAdminAssignmentListPresenter(),
  );

  registry.register(
    EVENT_ASSIGNMENT_ADMIN_BY_ASSIGNMENT_LIST_PRESENTER_KEY,
    new EventAssignmentAdminByAssignmentListPresenter(),
  );

  registry.register(
    EVENT_ASSIGNMENT_ADMIN_BY_RESOURCE_LIST_PRESENTER_KEY,
    new EventAssignmentAdminByResourceListPresenter(),
  );

  registry.register(
    EVENT_ASSIGNMENT_ADMIN_BY_PLATFORM_LIST_PRESENTER_KEY,
    new EventAssignmentAdminByPlatformListPresenter(),
  );

  registry.register(
    EVENT_ASSIGNMENT_ADMIN_DETAIL_PRESENTER_KEY,
    new EventAssignmentAdminDetailPresenter(),
  );
}
