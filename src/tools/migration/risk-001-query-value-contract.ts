import { Risk001SanitizedError } from "./risk-001-sanitized-error";

/** Closed runtime grammar for every RISK-001 read query and captured identity. */
export type CanonicalQueryValue =
  | null
  | boolean
  | string
  | number
  | readonly CanonicalQueryValue[]
  | CanonicalQueryObject;

export interface CanonicalQueryObject {
  readonly [key: string]: CanonicalQueryValue;
}

const MAX_QUERY_DEPTH = 100;
const MAX_QUERY_NODES = 10_000;

export function normalizeRisk001QueryValue(value: unknown): CanonicalQueryValue {
  return normalize(value, new WeakSet<object>(), { nodes: 0 }, 0);
}

export function stableSerializeRisk001QueryValue(value: unknown): string {
  return serialize(normalizeRisk001QueryValue(value));
}

function normalize(value: unknown, active: WeakSet<object>, state: { nodes: number }, depth: number): CanonicalQueryValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw unsupportedQueryValue();
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object" || depth >= MAX_QUERY_DEPTH || active.has(value)) throw unsupportedQueryValue();
  state.nodes += 1;
  if (state.nodes > MAX_QUERY_NODES) throw unsupportedQueryValue();
  active.add(value);
  try {
    return Array.isArray(value) ? normalizeArray(value, active, state, depth) : normalizeObject(value, active, state, depth);
  } finally {
    active.delete(value);
  }
}

function normalizeArray(value: readonly unknown[], active: WeakSet<object>, state: { nodes: number }, depth: number): readonly CanonicalQueryValue[] {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol" || (key !== "length" && !isArrayIndex(key))) throw unsupportedQueryValue();
    if (key !== "length") assertEnumerableDataProperty(value, key);
  }
  const normalized: CanonicalQueryValue[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw unsupportedQueryValue();
    normalized.push(normalize(assertEnumerableDataProperty(value, key).value, active, state, depth + 1));
  }
  return Object.freeze(normalized);
}

function normalizeObject(value: object, active: WeakSet<object>, state: { nodes: number }, depth: number): Readonly<Record<string, CanonicalQueryValue>> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw unsupportedQueryValue();
  assertNoInheritedEnumerableProperties(value);
  const entries: [string, CanonicalQueryValue][] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw unsupportedQueryValue();
    entries.push([key, normalize(assertEnumerableDataProperty(value, key).value, active, state, depth + 1)]);
  }
  entries.sort(([left], [right]) => left.localeCompare(right));
  return Object.freeze(Object.fromEntries(entries));
}

function assertEnumerableDataProperty(value: object, key: PropertyKey): PropertyDescriptor & { value: unknown } {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw unsupportedQueryValue();
  return descriptor as PropertyDescriptor & { value: unknown };
}

function assertNoInheritedEnumerableProperties(value: object): void {
  for (let prototype = Object.getPrototypeOf(value); prototype; prototype = Object.getPrototypeOf(prototype)) {
    for (const key of Reflect.ownKeys(prototype)) {
      if (Object.getOwnPropertyDescriptor(prototype, key)?.enumerable) throw unsupportedQueryValue();
    }
  }
}

function isArrayIndex(key: string): boolean {
  const number = Number(key);
  return Number.isInteger(number) && number >= 0 && number < 2 ** 32 - 1 && String(number) === key;
}

function serialize(value: CanonicalQueryValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  const object = value as CanonicalQueryObject;
  return `{${Object.keys(object).map((key) => `${JSON.stringify(key)}:${serialize(object[key] as CanonicalQueryValue)}`).join(",")}}`;
}

function unsupportedQueryValue(): Risk001SanitizedError {
  return new Risk001SanitizedError("VALIDATION_FAILED", "Unsupported query value grammar");
}
