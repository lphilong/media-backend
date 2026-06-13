import { PresenterRegistryWriter } from "@app/presenter/presenter.runtime-access";
import {
  CONTRACT_REGISTRY_ADMIN_BY_LINKED_ENTITY_LIST_PRESENTER_KEY,
  CONTRACT_REGISTRY_ADMIN_BY_OWNER_LIST_PRESENTER_KEY,
  CONTRACT_REGISTRY_ADMIN_DETAIL_PRESENTER_KEY,
  CONTRACT_REGISTRY_ADMIN_LIST_PRESENTER_KEY,
  CONTRACT_REGISTRY_ADMIN_MUTATION_PRESENTER_KEY,
  CONTRACT_OBLIGATION_ADMIN_DETAIL_PRESENTER_KEY,
  CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_ADMIN_DETAIL_PRESENTER_KEY,
  CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_ADMIN_LIST_PRESENTER_KEY,
  CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_ADMIN_MUTATION_PRESENTER_KEY,
  CONTRACT_OBLIGATION_ADMIN_LIST_PRESENTER_KEY,
  CONTRACT_OBLIGATION_ADMIN_MUTATION_PRESENTER_KEY,
} from "./contract-registry.presenter-keys";
import {
  ContractRegistryAdminByLinkedEntityListPresenter,
  ContractRegistryAdminByOwnerListPresenter,
  ContractRegistryAdminDetailPresenter,
  ContractRegistryAdminListPresenter,
  ContractRegistryAdminMutationPresenter,
  ContractObligationAdminDetailPresenter,
  ContractObligationEventEvidenceLinkAdminDetailPresenter,
  ContractObligationEventEvidenceLinkAdminListPresenter,
  ContractObligationEventEvidenceLinkAdminMutationPresenter,
  ContractObligationAdminListPresenter,
  ContractObligationAdminMutationPresenter,
} from "./contract-registry.presenter";

export function registerPresenters(
  registry: PresenterRegistryWriter,
): void {
  registry.register(
    CONTRACT_REGISTRY_ADMIN_MUTATION_PRESENTER_KEY,
    new ContractRegistryAdminMutationPresenter(),
  );

  registry.register(
    CONTRACT_REGISTRY_ADMIN_LIST_PRESENTER_KEY,
    new ContractRegistryAdminListPresenter(),
  );

  registry.register(
    CONTRACT_REGISTRY_ADMIN_BY_LINKED_ENTITY_LIST_PRESENTER_KEY,
    new ContractRegistryAdminByLinkedEntityListPresenter(),
  );

  registry.register(
    CONTRACT_REGISTRY_ADMIN_BY_OWNER_LIST_PRESENTER_KEY,
    new ContractRegistryAdminByOwnerListPresenter(),
  );

  registry.register(
    CONTRACT_REGISTRY_ADMIN_DETAIL_PRESENTER_KEY,
    new ContractRegistryAdminDetailPresenter(),
  );

  registry.register(
    CONTRACT_OBLIGATION_ADMIN_MUTATION_PRESENTER_KEY,
    new ContractObligationAdminMutationPresenter(),
  );
  registry.register(
    CONTRACT_OBLIGATION_ADMIN_LIST_PRESENTER_KEY,
    new ContractObligationAdminListPresenter(),
  );
  registry.register(
    CONTRACT_OBLIGATION_ADMIN_DETAIL_PRESENTER_KEY,
    new ContractObligationAdminDetailPresenter(),
  );
  registry.register(
    CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_ADMIN_MUTATION_PRESENTER_KEY,
    new ContractObligationEventEvidenceLinkAdminMutationPresenter(),
  );
  registry.register(
    CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_ADMIN_LIST_PRESENTER_KEY,
    new ContractObligationEventEvidenceLinkAdminListPresenter(),
  );
  registry.register(
    CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_ADMIN_DETAIL_PRESENTER_KEY,
    new ContractObligationEventEvidenceLinkAdminDetailPresenter(),
  );
}
