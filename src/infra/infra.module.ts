  import { Redis } from "ioredis";
  import { Db, MongoClient } from "mongodb";
  import { RedisCacheAdapter } from "./cache";
  import { BullMQQueueAdapter } from "./queue";
  import { StorageAdapter } from "./storage/storage.adapter";
  import { QueueRegistry } from "./queue/queue.registry";

  export interface InfraModule {
    readonly redis: Redis;
    readonly primaryDb: Db;
    readonly mongoClient: MongoClient;
    readonly queueRegistry: QueueRegistry;
    readonly cacheAdapter: RedisCacheAdapter;
    readonly queueAdapter: BullMQQueueAdapter;
    readonly storageAdapter: StorageAdapter;
  }

  /**
   * Pure DI factory.
   * No context binding.
   * No global state.
   */
  export function createInfraModule(params: {
    readonly redis: Redis;
    readonly primaryDb: Db;
    readonly mongoClient: MongoClient;
    readonly queueRegistry: QueueRegistry;
    readonly storage: StorageAdapter;
  }): InfraModule {
    return {
      redis: params.redis,
      primaryDb: params.primaryDb,
      mongoClient: params.mongoClient,
      queueRegistry: params.queueRegistry,
      cacheAdapter: new RedisCacheAdapter(params.redis),
      queueAdapter: new BullMQQueueAdapter(params.queueRegistry),
      storageAdapter: params.storage,
    };
  }
