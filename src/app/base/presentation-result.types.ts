export type JsonPrimitive = string | number | boolean | null;

export type PlainArrayEntry =
  | JsonPrimitive
  | PlainObject;

export type PlainArray = readonly PlainArrayEntry[];

export type PlainObject = {
  [k: string]:
    | JsonPrimitive
    | PlainObject
    | PlainArray;
};

export type PresentationEnvelope = {
  data: PlainObject | readonly PlainObject[];
  meta?: PlainObject;
};

export type PresentationResult = PresentationEnvelope;

function isJsonPrimitive(
  value: unknown,
): value is JsonPrimitive {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return (
    prototype === Object.prototype ||
    prototype === null
  );
}

function isPlainArrayEntryInternal(
  value: unknown,
  visiting: WeakSet<object>,
): value is PlainArrayEntry {
  return (
    isJsonPrimitive(value) ||
    isPlainObjectInternal(value, visiting)
  );
}

function isPlainArrayInternal(
  value: unknown,
  visiting: WeakSet<object>,
): value is PlainArray {
  return (
    Array.isArray(value) &&
    value.every((entry) =>
      isPlainArrayEntryInternal(entry, visiting),
    )
  );
}

function isPlainObjectInternal(
  value: unknown,
  visiting: WeakSet<object>,
): value is PlainObject {
  if (!isPlainRecord(value)) {
    return false;
  }

  if (visiting.has(value)) {
    return false;
  }

  visiting.add(value);

  try {
    for (const entry of Object.values(value)) {
      if (
        !isJsonPrimitive(entry) &&
        !isPlainObjectInternal(entry, visiting) &&
        !isPlainArrayInternal(entry, visiting)
      ) {
        return false;
      }
    }

    return true;
  } finally {
    visiting.delete(value);
  }
}

export function isPlainObject(
  value: unknown,
): value is PlainObject {
  return isPlainObjectInternal(
    value,
    new WeakSet<object>(),
  );
}

export function toPlainObject(
  value: unknown,
  label = "value",
): PlainObject {
  if (!isPlainObject(value)) {
    throw new TypeError(
      `${label} must be a plain JSON-compatible object`,
    );
  }

  return value;
}