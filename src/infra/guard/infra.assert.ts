import { SystemInvariantError } from "@core/error/system-error";

type BaseRuntimeContainerShape = {
  readonly primaryDb?: unknown;
  readonly redis?: unknown;
  readonly storage?: unknown;
  readonly queueRegistry?: unknown;
  readonly logger?: unknown;
};

type HttpRuntimeContainerShape =
  BaseRuntimeContainerShape & {
    readonly presenterRegistry?: unknown;
  };

function assertField(
  field:
    | keyof BaseRuntimeContainerShape
    | keyof HttpRuntimeContainerShape,
  value: unknown,
): void {
  if (!value) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `RuntimeContainer missing required field: ${String(field)}`,
    );
  }
}

export function assertBaseRuntimeContainerCompleteness(
  container: BaseRuntimeContainerShape,
): void {
  assertField("primaryDb", container.primaryDb);
  assertField("redis", container.redis);
  assertField("storage", container.storage);
  assertField("queueRegistry", container.queueRegistry);
  assertField("logger", container.logger);
}

export function assertHttpRuntimeContainerCompleteness(
  container: HttpRuntimeContainerShape,
): void {
  assertBaseRuntimeContainerCompleteness(container);
  assertField("presenterRegistry", container.presenterRegistry);
}
