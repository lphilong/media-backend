import { StorageAdapter } from "./storage.adapter";
import { StorageConfig } from "./storage.config";
import { UnsupportedStorageProviderError } from "@infra/errors/storage.error";
import { S3StorageAdapter } from "./s3.adapter";
import { LocalStorageAdapter } from "./local.adapter";

/**
 * Create storage adapter.
 * Lifecycle is owned by runtime.
 *
 * Current authoritative storage providers:
 * - s3
 * - local (dev only, fail-closed elsewhere)
 */
export function createStorageAdapter(
  config: StorageConfig,
): StorageAdapter {
  switch (config.provider) {
    case "s3":
      return new S3StorageAdapter(config);

    case "local":
      return new LocalStorageAdapter(config);

    default:
      throw new UnsupportedStorageProviderError(
        String(config.provider),
      );
  }
}