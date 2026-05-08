import { ExposureViolationError } from "./exposure.error";

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  return (
    proto === Object.prototype || proto === null
  );
}

function sanitizeValue(
  value: unknown,
  path: string,
): unknown {
  if (value === null) {
    return null;
  }

  const valueType = typeof value;

  if (valueType === "string" || valueType === "boolean") {
    return value;
  }

  if (valueType === "number") {
    if (!Number.isFinite(value)) {
      throw new ExposureViolationError(
        `Non-finite number exposure forbidden at ${path}`,
      );
    }

    return value;
  }

  if (valueType === "undefined") {
    throw new ExposureViolationError(
      `Undefined exposure forbidden at ${path}`,
    );
  }

  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((entry, index) =>
        sanitizeValue(entry, `${path}[${index}]`),
      ),
    );
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value)) {
      if (key.startsWith("_")) {
        throw new ExposureViolationError(
          `Private field exposure forbidden at ${path}.${key}`,
        );
      }

      if (entry === undefined) {
        continue;
      }

      out[key] = sanitizeValue(
        entry,
        `${path}.${key}`,
      );
    }

    return Object.freeze(out);
  }

  throw new ExposureViolationError(
    `Non-plain object exposure forbidden at ${path}`,
  );
}

function hasOwnKey<T extends object>(
  target: T,
  key: PropertyKey,
): key is keyof T {
  return Object.prototype.hasOwnProperty.call(
    target,
    key,
  );
}

export class ExposurePolicy {
  static sanitize<T>(input: T): T {
    return sanitizeValue(input, "$response") as T;
  }

  static expose<
    TInput extends Record<string, unknown>,
    TKey extends keyof TInput,
  >(
    input: TInput,
    allowed: readonly TKey[],
  ): Readonly<Pick<TInput, TKey>> {
    const result: Partial<Pick<TInput, TKey>> = {};

    for (const key of allowed) {
      if (!hasOwnKey(input, key)) {
        continue;
      }

      const value = input[key];

      if (value === undefined) {
        continue;
      }

      result[key] = sanitizeValue(
        value,
        String(key),
      ) as Pick<TInput, TKey>[TKey];
    }

    return Object.freeze(
      result as Pick<TInput, TKey>,
    );
  }
}