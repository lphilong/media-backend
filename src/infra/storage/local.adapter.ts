import {
  StorageAdapter,
  SignedUrlResult,
  UploadInput,
  DownloadInput,
} from "./storage.adapter";
import { StorageConfig } from "./storage.config";
import { StoragePolicy } from "./storage.policy";
import {
  SignedUrlGenerationError,
  StorageConfigError,
} from "@infra/errors/storage.error";
import { env } from "@config/env";

/**
 * DEV-ONLY adapter.
 * Uses a simple HTTP endpoint that accepts PUT/GET.
 */
export class LocalStorageAdapter
  implements StorageAdapter
{
  private readonly baseUrl: string;

  constructor(config: StorageConfig) {
    if (env.NODE_ENV === "production") {
      throw new StorageConfigError(
        "Local storage adapter is forbidden in production",
      );
    }

    if (!config.baseUrl) {
      throw new SignedUrlGenerationError(
        "STORAGE_BASE_URL missing for local",
      );
    }

    this.baseUrl = config.baseUrl.replace(/\/$/, "");
  }

  async getUploadUrl(
    input: UploadInput,
  ): Promise<SignedUrlResult> {
    const expiresAt =
      Date.now() +
      StoragePolicy.uploadTtlSeconds * 1000;

    return {
      url: `${this.baseUrl}/upload/${encodeURIComponent(input.key)}`,
      method: "PUT",
      expiresAt,
    };
  }

  async getDownloadUrl(
    input: DownloadInput,
  ): Promise<SignedUrlResult> {
    const expiresAt =
      Date.now() +
      StoragePolicy.downloadTtlSeconds * 1000;

    return {
      url: `${this.baseUrl}/files/${encodeURIComponent(input.key)}`,
      method: "GET",
      expiresAt,
    };
  }

  async deleteObject(_key: string): Promise<void> {
    // no-op for local
  }
}