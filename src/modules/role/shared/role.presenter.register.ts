import { PresenterRegistryWriter } from "@app/presenter/presenter.runtime-access";
import {
  ROLE_ADMIN_ASSIGNMENT_LIST_PRESENTER_KEY,
  ROLE_ADMIN_DETAIL_PRESENTER_KEY,
  ROLE_ADMIN_LIST_PRESENTER_KEY,
  ROLE_ADMIN_MUTATION_PRESENTER_KEY,
  ROLE_ADMIN_PERMISSION_MATRIX_PRESENTER_KEY,
} from "./role.presenter-keys";
import {
  RoleAdminAssignmentListPresenter,
  RoleAdminDetailPresenter,
  RoleAdminListPresenter,
  RoleAdminMutationPresenter,
  RoleAdminPermissionMatrixPresenter,
} from "./role.presenter";

export function registerPresenters(
  registry: PresenterRegistryWriter,
): void {
  registry.register(
    ROLE_ADMIN_MUTATION_PRESENTER_KEY,
    new RoleAdminMutationPresenter(),
  );

  registry.register(
    ROLE_ADMIN_LIST_PRESENTER_KEY,
    new RoleAdminListPresenter(),
  );

  registry.register(
    ROLE_ADMIN_DETAIL_PRESENTER_KEY,
    new RoleAdminDetailPresenter(),
  );

  registry.register(
    ROLE_ADMIN_ASSIGNMENT_LIST_PRESENTER_KEY,
    new RoleAdminAssignmentListPresenter(),
  );

  registry.register(
    ROLE_ADMIN_PERMISSION_MATRIX_PRESENTER_KEY,
    new RoleAdminPermissionMatrixPresenter(),
  );
}
