import {
  CacheAdapter,
  CacheGetOptions,
  CacheSetOptions,
} from "./cache.adapter";
import { Redis } from "ioredis";
import { InfrastructureError } from "../errors/infrastructure.error";

export class RedisCacheAdapter
  implements CacheAdapter
{
  constructor(private readonly redis: Redis) {}

  async get<T>(
    key: string,
    options?: CacheGetOptions,
  ): Promise<T | null> {
    let raw: string | null;

    try {
      raw = await this.redis.get(key);
    } catch (error) {
      throw new InfrastructureError(
        "CACHE_GET_FAILED",
        `Redis GET failed for key: ${key}`,
      );
    }

    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      await this.deleteCorruptedPayloadSafely(key);

      if (options?.allowStale) {
        return null;
      }

      throw new InfrastructureError(
        "CACHE_CORRUPTED",
        `Corrupted cache payload for key: ${key}`,
      );
    }
  }

  async set<T>(
    key: string,
    value: T,
    options: CacheSetOptions,
  ): Promise<void> {
    if (
      !Number.isInteger(options.ttlSeconds) ||
      options.ttlSeconds <= 0
    ) {
      throw new InfrastructureError(
        "INVALID_CACHE_TTL",
        "Cache TTL must be positive integer",
      );
    }

    try {
      await this.redis.set(
        key,
        JSON.stringify(value),
        "EX",
        options.ttlSeconds,
      );
    } catch (error) {
      throw new InfrastructureError(
        "CACHE_SET_FAILED",
        `Redis SET failed for key: ${key}`,
      );
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      throw new InfrastructureError(
        "CACHE_DELETE_FAILED",
        `Redis DEL failed for key: ${key}`,
      );
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await this.redis.exists(key)) === 1;
    } catch (error) {
      throw new InfrastructureError(
        "CACHE_EXISTS_FAILED",
        `Redis EXISTS failed for key: ${key}`,
      );
    }
  }

  private async deleteCorruptedPayloadSafely(
    key: string,
  ): Promise<void> {
    try {
      await this.redis.del(key);
    } catch {
      // Corrupted payload handling must stay deterministic and non-throwing here.
    }
  }
}