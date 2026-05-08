import { PresenterRegistry } from "@app/presenter/presenter.registry";
import { registerBootstrapPresenters } from "./module-registrar";

export function registerPresenters(
  registry: PresenterRegistry,
): void {
  registerBootstrapPresenters(registry);
}