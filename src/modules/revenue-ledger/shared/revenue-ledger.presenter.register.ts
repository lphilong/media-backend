import { PresenterRegistryWriter } from "@app/presenter/presenter.runtime-access";
import {
  REVENUE_LEDGER_ADMIN_BY_EVENT_LIST_PRESENTER_KEY,
  REVENUE_LEDGER_ADMIN_BY_PLATFORM_LIST_PRESENTER_KEY,
  REVENUE_LEDGER_ADMIN_BY_TALENT_LIST_PRESENTER_KEY,
  REVENUE_LEDGER_ADMIN_DETAIL_PRESENTER_KEY,
  REVENUE_LEDGER_ADMIN_LIST_PRESENTER_KEY,
  REVENUE_LEDGER_ADMIN_MUTATION_PRESENTER_KEY,
} from "./revenue-ledger.presenter-keys";
import {
  RevenueLedgerAdminByEventListPresenter,
  RevenueLedgerAdminByPlatformListPresenter,
  RevenueLedgerAdminByTalentListPresenter,
  RevenueLedgerAdminDetailPresenter,
  RevenueLedgerAdminListPresenter,
  RevenueLedgerAdminMutationPresenter,
} from "./revenue-ledger.presenter";

export function registerPresenters(
  registry: PresenterRegistryWriter,
): void {
  registry.register(
    REVENUE_LEDGER_ADMIN_MUTATION_PRESENTER_KEY,
    new RevenueLedgerAdminMutationPresenter(),
  );

  registry.register(
    REVENUE_LEDGER_ADMIN_LIST_PRESENTER_KEY,
    new RevenueLedgerAdminListPresenter(),
  );

  registry.register(
    REVENUE_LEDGER_ADMIN_BY_TALENT_LIST_PRESENTER_KEY,
    new RevenueLedgerAdminByTalentListPresenter(),
  );

  registry.register(
    REVENUE_LEDGER_ADMIN_BY_PLATFORM_LIST_PRESENTER_KEY,
    new RevenueLedgerAdminByPlatformListPresenter(),
  );

  registry.register(
    REVENUE_LEDGER_ADMIN_BY_EVENT_LIST_PRESENTER_KEY,
    new RevenueLedgerAdminByEventListPresenter(),
  );

  registry.register(
    REVENUE_LEDGER_ADMIN_DETAIL_PRESENTER_KEY,
    new RevenueLedgerAdminDetailPresenter(),
  );
}
