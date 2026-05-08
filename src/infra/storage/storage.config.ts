import { env } from "@config/env";
import { StorageConfigError } from "@infra/errors/storage.error";

export type StorageProvider = "s3" | "local";

export interface StorageConfig {
  provider: StorageProvider;
  bucket: string;
  region?: string;
  baseUrl?: string;
}

export function loadStorageConfig(): StorageConfig {
  const provider = env.STORAGE_PROVIDER;
  const bucket = env.STORAGE_BUCKET;

  if (!provider) {
    throw new StorageConfigError(
      "STORAGE_PROVIDER missing",
    );
  }

  if (
    env.NODE_ENV === "production" &&
    provider === "local"
  ) {
    throw new StorageConfigError(
      "STORAGE_PROVIDER=local is forbidden in production",
    );
  }

  if (provider === "local") {
    if (!env.STORAGE_BASE_URL) {
      throw new StorageConfigError(
        "STORAGE_BASE_URL missing",
      );
    }

    return {
      provider,
      bucket: "local",
      baseUrl: env.STORAGE_BASE_URL,
    };
  }

  if (!bucket) {
    throw new StorageConfigError(
      "STORAGE_BUCKET missing",
    );
  }

  if (!env.STORAGE_REGION) {
    throw new StorageConfigError(
      "STORAGE_REGION missing",
    );
  }

  return {
    provider,
    bucket,
    region: env.STORAGE_REGION,
  };
}