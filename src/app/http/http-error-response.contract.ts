import type { ServerResponse } from "http";
import { SystemInvariantError } from "@core/error/system-error";
import {
  HttpError,
  HttpErrorDetails,
  HttpErrorDetailValue,
  HttpErrorResponse,
} from "./http-error.types";

const ERROR_DETAIL_ALLOWLIST: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({});

function throwErrorContractViolation(): never {
  throw new SystemInvariantError(
    "HTTP_ERROR_CONTRACT_VIOLATION",
    "HTTP error contract violation",
  );
}

function isFiniteNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}

function isDetailPrimitive(
  value: unknown,
): value is string | number | boolean | null {
  if (value === null) {
    return true;
  }

  if (typeof value === "string") {
    return true;
  }

  if (typeof value === "boolean") {
    return true;
  }

  return isFiniteNumber(value);
}

function assertDetailValue(
  value: unknown,
): asserts value is HttpErrorDetailValue {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isDetailPrimitive(item)) {
        throwErrorContractViolation();
      }
    }
    return;
  }

  if (!isDetailPrimitive(value)) {
    throwErrorContractViolation();
  }
}

function assertDetailsObject(
  details: unknown,
): asserts details is HttpErrorDetails {
  if (
    details === undefined ||
    details === null ||
    typeof details !== "object" ||
    Array.isArray(details)
  ) {
    throwErrorContractViolation();
  }

  if (Object.getPrototypeOf(details) !== Object.prototype) {
    throwErrorContractViolation();
  }

  for (const [, value] of Object.entries(details)) {
    assertDetailValue(value);
  }
}

function sanitizeRequestId(
  requestId: string | undefined,
): string | undefined {
  if (requestId === undefined) {
    return undefined;
  }

  const normalized = requestId.trim();
  if (normalized.length === 0) {
    return undefined;
  }

  return normalized;
}

function sanitizeDetails(
  errorCode: string,
  details: HttpErrorDetails | undefined,
): HttpErrorDetails | undefined {
  if (details === undefined) {
    return undefined;
  }

  assertDetailsObject(details);

  const allowedKeys =
    ERROR_DETAIL_ALLOWLIST[errorCode] ?? [];

  if (allowedKeys.length === 0) {
    return undefined;
  }

  const source = details as Record<string, unknown>;
  const sanitized: Record<string, HttpErrorDetailValue> =
    {};

  for (const key of allowedKeys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      continue;
    }

    const value = source[key];
    assertDetailValue(value);
    sanitized[key] = value;
  }

  if (Object.keys(sanitized).length === 0) {
    return undefined;
  }

  return Object.freeze(sanitized);
}

export function createHttpErrorResponse(params: {
  readonly error: HttpError;
  readonly requestId?: string;
  readonly includeRequestId: boolean;
}): HttpErrorResponse {
  const sanitizedDetails = sanitizeDetails(
    params.error.code,
    params.error.details,
  );
  const normalizedRequestId = sanitizeRequestId(
    params.requestId,
  );

  const response = {
    error: {
      code: params.error.code,
      message: params.error.message,
      ...(sanitizedDetails
        ? { details: sanitizedDetails }
        : {}),
    },
    ...(params.includeRequestId && normalizedRequestId
      ? { meta: { requestId: normalizedRequestId } }
      : {}),
  } satisfies HttpErrorResponse;

  assertHttpErrorResponse(response);
  return response;
}

type HttpErrorResponseWritable = Pick<
  ServerResponse,
  "statusCode" | "setHeader" | "end"
>;

export function writeCanonicalHttpErrorResponse(params: {
  readonly response: HttpErrorResponseWritable;
  readonly error: HttpError;
  readonly requestId?: string;
  readonly includeRequestId: boolean;
}): void {
  const payload = createHttpErrorResponse({
    error: params.error,
    requestId: params.requestId,
    includeRequestId: params.includeRequestId,
  });

  params.response.statusCode = params.error.status;
  params.response.setHeader(
    "Content-Type",
    "application/json",
  );
  params.response.end(JSON.stringify(payload));
}

export function assertHttpErrorResponse(
  payload: unknown,
): asserts payload is HttpErrorResponse {
  if (
    payload === null ||
    payload === undefined ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throwErrorContractViolation();
  }

  if (Object.getPrototypeOf(payload) !== Object.prototype) {
    throwErrorContractViolation();
  }

  const envelope = payload as Record<string, unknown>;
  const keys = Object.keys(envelope);

  if (!Object.prototype.hasOwnProperty.call(envelope, "error")) {
    throwErrorContractViolation();
  }

  for (const key of keys) {
    if (key !== "error" && key !== "meta") {
      throwErrorContractViolation();
    }
  }

  const error = envelope.error;
  if (
    error === null ||
    error === undefined ||
    typeof error !== "object" ||
    Array.isArray(error)
  ) {
    throwErrorContractViolation();
  }

  if (Object.getPrototypeOf(error) !== Object.prototype) {
    throwErrorContractViolation();
  }

  const errorRecord = error as Record<string, unknown>;
  const errorKeys = Object.keys(errorRecord);

  if (
    typeof errorRecord.code !== "string" ||
    errorRecord.code.trim().length === 0
  ) {
    throwErrorContractViolation();
  }

  if (
    typeof errorRecord.message !== "string" ||
    errorRecord.message.trim().length === 0
  ) {
    throwErrorContractViolation();
  }

  for (const key of errorKeys) {
    if (
      key !== "code" &&
      key !== "message" &&
      key !== "details"
    ) {
      throwErrorContractViolation();
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(
      errorRecord,
      "details",
    )
  ) {
    assertDetailsObject(errorRecord.details);
  }

  if (
    Object.prototype.hasOwnProperty.call(envelope, "meta")
  ) {
    const meta = envelope.meta;
    if (
      meta === null ||
      meta === undefined ||
      typeof meta !== "object" ||
      Array.isArray(meta)
    ) {
      throwErrorContractViolation();
    }

    if (Object.getPrototypeOf(meta) !== Object.prototype) {
      throwErrorContractViolation();
    }

    const metaRecord = meta as Record<string, unknown>;
    const metaKeys = Object.keys(metaRecord);
    if (
      metaKeys.length !== 1 ||
      metaKeys[0] !== "requestId"
    ) {
      throwErrorContractViolation();
    }

    if (
      typeof metaRecord.requestId !== "string" ||
      metaRecord.requestId.trim().length === 0
    ) {
      throwErrorContractViolation();
    }
  }
}
