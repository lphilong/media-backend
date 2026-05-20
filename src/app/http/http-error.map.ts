import { HttpError } from "./http-error.types";
import { SystemInvariantError } from "@core/error/system-error";
import { BaseAppError } from "@core/errors/base.error";
import {
  InsufficientScopeError,
  InvalidRequestError,
  InvalidTokenError,
  UnauthorizedError,
} from "express-oauth2-jwt-bearer";

type OAuth2BearerErrorName =
  | "UnauthorizedError"
  | "InvalidTokenError"
  | "InvalidRequestError"
  | "InsufficientScopeError";

type OAuth2BearerErrorCode =
  | "invalid_token"
  | "invalid_request"
  | "insufficient_scope";

const OAUTH2_BEARER_ERROR_NAMES =
  new Set<OAuth2BearerErrorName>([
    "UnauthorizedError",
    "InvalidTokenError",
    "InvalidRequestError",
    "InsufficientScopeError",
  ]);

const OAUTH2_BEARER_ERROR_CODES =
  new Set<OAuth2BearerErrorCode>([
    "invalid_token",
    "invalid_request",
    "insufficient_scope",
  ]);

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

  const oauth2BearerError =
    mapOAuth2BearerError(err);

  if (oauth2BearerError) {
    return oauth2BearerError;
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

function mapOAuth2BearerError(
  err: unknown,
): HttpError | undefined {
  if (!isOAuth2BearerError(err)) {
    return undefined;
  }

  const name = readStringProperty(err, "name");
  const code = readStringProperty(err, "code");
  const status = readSafeOAuth2BearerStatus(err);

  if (
    err instanceof InsufficientScopeError ||
    name === "InsufficientScopeError" ||
    code === "insufficient_scope"
  ) {
    return new HttpError(
      403,
      "FORBIDDEN",
      "Permission denied",
    );
  }

  if (
    err instanceof InvalidRequestError ||
    name === "InvalidRequestError" ||
    code === "invalid_request"
  ) {
    return new HttpError(
      400,
      "BAD_REQUEST",
      "Invalid authentication request",
    );
  }

  if (
    err instanceof InvalidTokenError ||
    err instanceof UnauthorizedError ||
    name === "InvalidTokenError" ||
    name === "UnauthorizedError" ||
    code === "invalid_token"
  ) {
    return new HttpError(
      401,
      "UNAUTHORIZED",
      "Invalid authentication",
    );
  }

  if (status === 403) {
    return new HttpError(
      403,
      "FORBIDDEN",
      "Permission denied",
    );
  }

  if (status === 400) {
    return new HttpError(
      400,
      "BAD_REQUEST",
      "Invalid authentication request",
    );
  }

  if (status === 401) {
    return new HttpError(
      401,
      "UNAUTHORIZED",
      "Invalid authentication",
    );
  }

  return undefined;
}

function isOAuth2BearerError(
  err: unknown,
): err is Record<string, unknown> {
  if (
    err instanceof UnauthorizedError ||
    err instanceof InvalidTokenError ||
    err instanceof InvalidRequestError ||
    err instanceof InsufficientScopeError
  ) {
    return true;
  }

  if (
    typeof err !== "object" ||
    err === null ||
    Array.isArray(err)
  ) {
    return false;
  }

  const candidate = err as Record<string, unknown>;
  const name = readStringProperty(candidate, "name");
  const code = readStringProperty(candidate, "code");
  const status =
    readSafeOAuth2BearerStatus(candidate);

  if (!status) {
    return false;
  }

  return (
    isOAuth2BearerErrorName(name) ||
    isOAuth2BearerErrorCode(code)
  );
}

function readSafeOAuth2BearerStatus(
  err: Record<string, unknown>,
): 400 | 401 | 403 | undefined {
  const statusCode = readStatus(err.statusCode);
  if (statusCode) {
    return statusCode;
  }

  return readStatus(err.status);
}

function readStatus(
  value: unknown,
): 400 | 401 | 403 | undefined {
  if (value === 400 || value === 401 || value === 403) {
    return value;
  }

  return undefined;
}

function readStringProperty(
  source: Record<string, unknown>,
  property: string,
): string | undefined {
  const value = source[property];

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0
    ? normalized
    : undefined;
}

function isOAuth2BearerErrorName(
  value: string | undefined,
): value is OAuth2BearerErrorName {
  return (
    value !== undefined &&
    OAUTH2_BEARER_ERROR_NAMES.has(
      value as OAuth2BearerErrorName,
    )
  );
}

function isOAuth2BearerErrorCode(
  value: string | undefined,
): value is OAuth2BearerErrorCode {
  return (
    value !== undefined &&
    OAUTH2_BEARER_ERROR_CODES.has(
      value as OAuth2BearerErrorCode,
    )
  );
}
