import { InfrastructureError } from "./infrastructure.error";

export class RedisConfigurationError extends InfrastructureError {
  constructor() {
    super(
      "REDIS_CONFIGURATION_MISSING",
      "REDIS_URL is not configured",
      "Redis configuration missing",
      500,
    );
  }
}