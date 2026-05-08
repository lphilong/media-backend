import { InfrastructureError } from "@infra/errors/infrastructure.error";

/**
 * Storage-specific infrastructure failures.
 * These errors belong to the infrastructure failure domain:
 * - provider misconfiguration
 * - unsupported provider selection
 * - signed URL generation failure
 *
 * They must never be used for domain/business validation.
 */

export class StorageConfigError extends InfrastructureError {
  constructor(message: string) {
    super(
      "STORAGE_CONFIG_ERROR",
      message,
      "Storage configuration error",
      500,
    );
  }
}

export class UnsupportedStorageProviderError extends InfrastructureError {
  constructor(provider: string) {
    super(
      "STORAGE_PROVIDER_UNSUPPORTED",
      `Unsupported storage provider: ${provider}`,
      "Storage provider not supported",
      500,
    );
  }
}

export class SignedUrlGenerationError extends InfrastructureError {
  constructor(message: string) {
    super(
      "STORAGE_SIGNED_URL_GENERATION_FAILED",
      message,
      "Failed to generate signed URL",
      500,
    );
  }
}