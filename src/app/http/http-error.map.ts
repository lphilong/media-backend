import { HttpError } from "./http-error.types";
import { SystemInvariantError } from "@core/error/system-error";
import { BaseAppError } from "@core/errors/base.error";

/**
 * Map internal errors to HTTP-safe errors.
 * This is the ONLY mapping table.
 * 
 * Rules:
 * - Domain / BaseAppError → trust its httpStatus + safeMessage
 * - SystemInvariantError → never leak internal message
 * - Unknown → 500
 */
export function mapToHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) {
    return err;
  }

  /**
   * Domain / Application errors
   */
  if (err instanceof BaseAppError) {
    return new HttpError(
      err.httpStatus,
      err.code,
      err.safeMessage,
    );
  }

  /**
   * System invariant errors (Security Kernel)
   */
  if (err instanceof SystemInvariantError) {
    switch (err.code) {
      case "ACTOR_INVALID_PAYLOAD":
        return new HttpError(
          401,
          "UNAUTHORIZED",
          "Invalid authentication",
        );

      case "ACTOR_INACTIVE":
        return new HttpError(
          403,
          "FORBIDDEN",
          "Access denied",
        );

      case "PERMISSION_DENIED":
      case "PERMISSION_CONTEXT_VIOLATION":
        return new HttpError(
          403,
          "FORBIDDEN",
          "Permission denied",
        );

      case "CONTEXT_INVALID":
        return new HttpError(
          400,
          "BAD_REQUEST",
          "Invalid request context",
        );

      case "HTTP_PRESENTATION_CONTRACT_VIOLATION":
        return new HttpError(
          500,
          "HTTP_PRESENTATION_CONTRACT_VIOLATION",
          "Presentation contract violation",
        );

      case "HTTP_ERROR_CONTRACT_VIOLATION":
        return new HttpError(
          500,
          "HTTP_ERROR_CONTRACT_VIOLATION",
          "Error contract violation",
        );

      case "HTTP_RESPONSE_SIDE_WRITE_FORBIDDEN":
        return new HttpError(
          500,
          "HTTP_RESPONSE_SIDE_WRITE_FORBIDDEN",
          "HTTP response side-write forbidden",
        );

      default:
        return new HttpError(
          500,
          "SYSTEM_ERROR",
          "Internal system error",
        );
    }
  }

  /**
   * Unknown / unexpected error
   */
  return new HttpError(
    500,
    "INTERNAL_ERROR",
    "Unexpected error",
  );
}
