import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  StorageAdapter,
  SignedUrlResult,
  UploadInput,
  DownloadInput,
} from "./storage.adapter";
import { StorageConfig } from "./storage.config";
import { StoragePolicy } from "./storage.policy";
import { SignedUrlGenerationError } from "@infra/errors/storage.error";
import { InfrastructureError } from "@infra/errors/infrastructure.error";

export class S3StorageAdapter implements StorageAdapter {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: StorageConfig) {
    if (!config.bucket) {
      throw new InfrastructureError(
        "S3_BUCKET_MISSING",
        "S3 bucket is required for S3 storage adapter",
      );
    }

    if (!config.region) {
      throw new InfrastructureError(
        "S3_REGION_MISSING",
        "S3 region is required for S3 storage adapter",
      );
    }

    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
    });
  }

  async getUploadUrl(
    input: UploadInput,
  ): Promise<SignedUrlResult> {
    const expiresAt =
      Date.now() +
      StoragePolicy.uploadTtlSeconds * 1000;

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        ContentType: input.contentType,
      });

      const url = await getSignedUrl(
        this.client,
        command,
        {
          expiresIn: StoragePolicy.uploadTtlSeconds,
        },
      );

      return {
        url,
        method: "PUT",
        expiresAt,
      };
    } catch {
      throw new SignedUrlGenerationError(
        "S3 upload URL failed",
      );
    }
  }

  async getDownloadUrl(
    input: DownloadInput,
  ): Promise<SignedUrlResult> {
    const expiresAt =
      Date.now() +
      StoragePolicy.downloadTtlSeconds * 1000;

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
      });

      const url = await getSignedUrl(
        this.client,
        command,
        {
          expiresIn: StoragePolicy.downloadTtlSeconds,
        },
      );

      return {
        url,
        method: "GET",
        expiresAt,
      };
    } catch {
      throw new SignedUrlGenerationError(
        "S3 download URL failed",
      );
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch {
      throw new InfrastructureError(
        "S3_DELETE_FAILED",
        `S3 delete failed for key: ${key}`,
      );
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );

      return true;
    } catch (error: unknown) {
      if (isS3NotFound(error)) {
        return false;
      }

      throw new InfrastructureError(
        "S3_EXISTS_CHECK_FAILED",
        `S3 existence check failed for key: ${key}`,
      );
    }
  }
}

function isS3NotFound(
  error: unknown,
): boolean {
  if (
    typeof error !== "object" ||
    error === null
  ) {
    return false;
  }

  const candidate = error as {
    $metadata?: {
      httpStatusCode?: number;
    };
    name?: unknown;
  };

  if (
    candidate.$metadata?.httpStatusCode === 404
  ) {
    return true;
  }

  return candidate.name === "NotFound";
}