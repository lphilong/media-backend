import { Db } from "mongodb";
import { Redis } from "ioredis";

import { StorageAdapter } from "@infra/storage/storage.adapter";
import { PresenterRegistry } from "@app/presenter/presenter.registry";
import { QueueRegistry } from "@infra/queue/queue.registry";
import { StructuredLogger } from "@infra/logger.adapter";

export interface BaseRuntimeContainer {
  readonly primaryDb: Db;
  readonly redis: Redis;
  readonly storage: StorageAdapter;
  readonly queueRegistry: QueueRegistry;
  readonly logger: StructuredLogger;
}

export interface HttpRuntimeContainer
  extends BaseRuntimeContainer {
  readonly presenterRegistry: PresenterRegistry;
}
