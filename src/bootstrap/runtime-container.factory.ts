import {
  BaseRuntimeContainer,
  HttpRuntimeContainer,
} from "./runtime-container";
import {
  assertHttpRuntimeContainer,
  assertSystemRuntimeContainer,
} from "./runtime-container.assert";

export function createSystemRuntimeContainer(
  container: BaseRuntimeContainer,
): BaseRuntimeContainer {
  assertSystemRuntimeContainer(container);
  return Object.freeze(container);
}

export function createHttpRuntimeContainer(
  container: HttpRuntimeContainer,
): HttpRuntimeContainer {
  assertHttpRuntimeContainer(container);
  return Object.freeze(container);
}
