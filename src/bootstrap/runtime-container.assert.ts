import {
  assertBaseRuntimeContainerCompleteness,
  assertHttpRuntimeContainerCompleteness,
} from "../infra/guard/infra.assert";
import {
  BaseRuntimeContainer,
  HttpRuntimeContainer,
} from "./runtime-container";

export function assertSystemRuntimeContainer(
  container: BaseRuntimeContainer,
): void {
  assertBaseRuntimeContainerCompleteness({
    primaryDb: container.primaryDb,
    redis: container.redis,
    storage: container.storage,
    queueRegistry: container.queueRegistry,
    logger: container.logger,
  });
}

export function assertHttpRuntimeContainer(
  container: HttpRuntimeContainer,
): void {
  assertHttpRuntimeContainerCompleteness({
    primaryDb: container.primaryDb,
    redis: container.redis,
    storage: container.storage,
    presenterRegistry: container.presenterRegistry,
    queueRegistry: container.queueRegistry,
    logger: container.logger,
  });
}
