import { SystemInvariantError } from "../../core/error/system-error";
import { PresentationResult } from "./presentation-result.types";

function throwPresentationViolation(): never {
  throw new SystemInvariantError(
    "HTTP_PRESENTATION_CONTRACT_VIOLATION",
    "Presentation contract violation",
  );
}

function isTypedArrayOrDataView(value: object): boolean {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return false;
  }

  return ArrayBuffer.isView(value);
}

function validatePrimitive(value: unknown): void {
  if (value === undefined) {
    throwPresentationViolation();
  }

  if (value === null) {
    return;
  }

  const t = typeof value;

  if (t === "string" || t === "boolean") {
    return;
  }

  if (t === "number") {
    if (!Number.isFinite(value)) {
      throwPresentationViolation();
    }
    return;
  }

  throwPresentationViolation();
}

function validatePlainObject(value: unknown): void {
  if (
    value === null ||
    value === undefined ||
    typeof value !== "object"
  ) {
    throwPresentationViolation();
  }

  if (
    value instanceof Date ||
    value instanceof Map ||
    value instanceof Set
  ) {
    throwPresentationViolation();
  }

  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    throwPresentationViolation();
  }

  if (isTypedArrayOrDataView(value)) {
    throwPresentationViolation();
  }

  const toJSON = (value as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === "function") {
    throwPresentationViolation();
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throwPresentationViolation();
  }

  for (const [, childValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    validatePlainObjectValue(childValue);
  }
}

function validatePlainObjectArray(
  value: readonly unknown[],
): void {
  for (const entry of value) {
    if (Array.isArray(entry)) {
      throwPresentationViolation();
    }

    validatePlainObject(entry);
  }
}

function validatePlainObjectValue(value: unknown): void {
  if (Array.isArray(value)) {
    validatePlainObjectArray(value);
    return;
  }

  if (
    value === null ||
    value === undefined ||
    typeof value !== "object"
  ) {
    validatePrimitive(value);
    return;
  }

  validatePlainObject(value);
}

export function assertPresentationResult(
  output: unknown,
): asserts output is PresentationResult {
  if (
    output === undefined ||
    output === null ||
    Array.isArray(output) ||
    typeof output !== "object"
  ) {
    throwPresentationViolation();
  }

  if (Object.getPrototypeOf(output) !== Object.prototype) {
    throwPresentationViolation();
  }

  const envelope = output as Record<string, unknown>;
  const keys = Object.keys(envelope);

  if (
    !Object.prototype.hasOwnProperty.call(
      envelope,
      "data",
    )
  ) {
    throwPresentationViolation();
  }

  for (const key of keys) {
    if (key !== "data" && key !== "meta") {
      throwPresentationViolation();
    }
  }

  const data = envelope.data;
  if (Array.isArray(data)) {
    validatePlainObjectArray(data);
  } else {
    validatePlainObject(data);
  }

  if (
    Object.prototype.hasOwnProperty.call(
      envelope,
      "meta",
    )
  ) {
    validatePlainObject(envelope.meta);
  }
}