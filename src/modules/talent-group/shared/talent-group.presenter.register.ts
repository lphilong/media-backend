import { PresenterRegistryWriter } from "@app/presenter/presenter.runtime-access";
import {
  TALENT_GROUP_ADMIN_BY_TALENT_LIST_PRESENTER_KEY,
  TALENT_GROUP_ADMIN_DETAIL_PRESENTER_KEY,
  TALENT_GROUP_ADMIN_LIST_PRESENTER_KEY,
  TALENT_GROUP_ADMIN_MEMBER_LIST_PRESENTER_KEY,
  TALENT_GROUP_ADMIN_MUTATION_PRESENTER_KEY,
} from "./talent-group.presenter-keys";
import {
  TalentGroupAdminByTalentListPresenter,
  TalentGroupAdminDetailPresenter,
  TalentGroupAdminListPresenter,
  TalentGroupAdminMemberListPresenter,
  TalentGroupAdminMutationPresenter,
} from "./talent-group.presenter";

export function registerPresenters(registry: PresenterRegistryWriter): void {
  registry.register(
    TALENT_GROUP_ADMIN_MUTATION_PRESENTER_KEY,
    new TalentGroupAdminMutationPresenter(),
  );

  registry.register(
    TALENT_GROUP_ADMIN_LIST_PRESENTER_KEY,
    new TalentGroupAdminListPresenter(),
  );

  registry.register(
    TALENT_GROUP_ADMIN_DETAIL_PRESENTER_KEY,
    new TalentGroupAdminDetailPresenter(),
  );

  registry.register(
    TALENT_GROUP_ADMIN_MEMBER_LIST_PRESENTER_KEY,
    new TalentGroupAdminMemberListPresenter(),
  );

  registry.register(
    TALENT_GROUP_ADMIN_BY_TALENT_LIST_PRESENTER_KEY,
    new TalentGroupAdminByTalentListPresenter(),
  );
}
