import { env } from "@config/env";
import { InfrastructureError } from "../errors/infrastructure.error";

function assertPositiveInt(
  value: number,
  name: string,
): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new InfrastructureError(
      "INVALID_STORAGE_TTL",
      `${name} must be a positive integer`,
    );
  }

  return value;
}

export const StoragePolicy = Object.freeze({
  uploadTtlSeconds: assertPositiveInt(
    env.STORAGE_UPLOAD_TTL,
    "STORAGE_UPLOAD_TTL",
  ),
  downloadTtlSeconds: assertPositiveInt(
    env.STORAGE_DOWNLOAD_TTL,
    "STORAGE_DOWNLOAD_TTL",
  ),
});