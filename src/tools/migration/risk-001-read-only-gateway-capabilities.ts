export const RISK_001_ACCEPTED_READ_ONLY_CAPABILITIES = Object.freeze([
  "aggregate",
  "countDocuments",
  "distinct",
  "find",
  "findOne",
  "ping",
] as const);

export const RISK_001_PROHIBITED_GATEWAY_CAPABILITIES = Object.freeze([
  "insertOne", "insertMany", "updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany", "bulkWrite",
  "findOneAndUpdate", "findOneAndDelete", "findOneAndReplace", "watch", "startSession",
  "client", "db", "database", "collection", "cursor", "session", "transaction",
] as const);

import {
  Risk001SanitizedError,
  sanitizeSensitiveText,
  type Risk001GatewayFailureCategory,
} from "./risk-001-sanitized-error";

export function readOnlyGatewayCapabilityNames(facade: object): readonly string[] {
  return Object.freeze(Object.getOwnPropertyNames(facade).filter((name) => name !== "constructor").sort());
}

export function createRisk001ReadOnlyGatewayCapabilityFacade(): object {
  return Object.freeze(Object.fromEntries(
    RISK_001_ACCEPTED_READ_ONLY_CAPABILITIES.map((name) => [name, () => undefined]),
  ));
}

/** Production uses this import-safe invariant when binding its concrete gateway prototype. */
export function bindRisk001ReadOnlyGatewayCapabilities(facade: object): readonly string[] {
  const actual = readOnlyGatewayCapabilityNames(facade);
  if (
    actual.length !== RISK_001_ACCEPTED_READ_ONLY_CAPABILITIES.length ||
    actual.some((name, index) => name !== RISK_001_ACCEPTED_READ_ONLY_CAPABILITIES[index]) ||
    RISK_001_PROHIBITED_GATEWAY_CAPABILITIES.some((name) => actual.includes(name))
  ) {
    throw new Error("RISK-001 read-only gateway capability surface changed");
  }
  return actual;
}

const READ_ONLY_AGGREGATE_STAGES = new Set([
  "$addFields", "$bucket", "$bucketAuto", "$count", "$densify", "$facet", "$fill", "$geoNear", "$group", "$limit",
  "$lookup", "$match", "$project", "$redact", "$replaceRoot", "$replaceWith", "$sample", "$set", "$setWindowFields",
  "$skip", "$sort", "$sortByCount", "$unionWith", "$unset", "$unwind",
]);
const PROHIBITED_AGGREGATE_STAGES = new Set(["$out", "$merge"]);

export const READ_ONLY_AGGREGATE_MIN_TIME_MS = 1;
export const READ_ONLY_AGGREGATE_DEFAULT_TIME_MS = 30_000;
export const READ_ONLY_AGGREGATE_MAX_TIME_MS = 120_000;

export function assertReadOnlyAggregatePipeline(pipeline: readonly object[]): void {
  assertPipeline(pipeline, "top-level", true);
}

function assertPipeline(pipeline: readonly object[], location: string, requireFinalLimit: boolean): void {
  if (!Array.isArray(pipeline)) throw new Risk001SanitizedError("VALIDATION_FAILED", `Aggregate ${location} pipeline must be an array`);
  let boundedLimit = false;
  for (const [index, stage] of pipeline.entries()) {
    if (!stage || typeof stage !== "object" || Array.isArray(stage)) throw new Risk001SanitizedError("VALIDATION_FAILED", `Aggregate ${location} stage ${index} must be an object`);
    const keys = Object.keys(stage);
    if (keys.length !== 1) throw new Risk001SanitizedError("VALIDATION_FAILED", `Aggregate stage ${index} must contain exactly one operator`);
    const operator = keys[0] as string;
    if (PROHIBITED_AGGREGATE_STAGES.has(operator) || !READ_ONLY_AGGREGATE_STAGES.has(operator)) {
      throw new Risk001SanitizedError("VALIDATION_FAILED", `Aggregate stage ${operator} is not allowed in read-only mode`);
    }
    if (operator === "$limit") {
      const limit = (stage as { readonly $limit?: unknown }).$limit;
      boundedLimit = typeof limit === "number" && Number.isInteger(limit) && limit >= 1 && limit <= 10_000;
      if (!boundedLimit) throw new Risk001SanitizedError("VALIDATION_FAILED", "Aggregate result limit must be an integer from 1 through 10000");
    }
    validateKnownNestedPipelines(operator, (stage as Record<string, unknown>)[operator], `${location}.${operator}`);
  }
  const finalStage = pipeline[pipeline.length - 1];
  if (requireFinalLimit && (!boundedLimit || !finalStage || Object.keys(finalStage)[0] !== "$limit")) {
    throw new Risk001SanitizedError("VALIDATION_FAILED", "Read-only aggregate pipeline requires a bounded final $limit stage");
  }
}

function validateKnownNestedPipelines(operator: string, value: unknown, location: string): void {
  if (operator === "$lookup") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Risk001SanitizedError("VALIDATION_FAILED", "$lookup must be an object");
    const pipeline = (value as { readonly pipeline?: unknown }).pipeline;
    if (pipeline !== undefined) assertPipelineValue(pipeline, `${location}.pipeline`);
  } else if (operator === "$facet") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Risk001SanitizedError("VALIDATION_FAILED", "$facet must be an object of pipelines");
    for (const [name, pipeline] of Object.entries(value)) assertPipelineValue(pipeline, `${location}.${name}`);
  } else if (operator === "$unionWith") {
    if (typeof value === "string" && value.length > 0) return;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Risk001SanitizedError("VALIDATION_FAILED", "$unionWith must be a collection name or object");
    const pipeline = (value as { readonly pipeline?: unknown }).pipeline;
    if (pipeline !== undefined) assertPipelineValue(pipeline, `${location}.pipeline`);
  }
}

function assertPipelineValue(value: unknown, location: string): void {
  if (!Array.isArray(value)) throw new Risk001SanitizedError("VALIDATION_FAILED", `Aggregate ${location} must be an array`);
  assertPipeline(value as readonly object[], location, false);
}

export function normalizeReadOnlyAggregateMaxTimeMS(value?: number): number {
  const normalized = value ?? READ_ONLY_AGGREGATE_DEFAULT_TIME_MS;
  if (typeof normalized !== "number" || !Number.isFinite(normalized) || !Number.isInteger(normalized) || normalized < READ_ONLY_AGGREGATE_MIN_TIME_MS || normalized > READ_ONLY_AGGREGATE_MAX_TIME_MS) {
    throw new Risk001SanitizedError("VALIDATION_FAILED", `Aggregate maxTimeMS must be an integer from ${READ_ONLY_AGGREGATE_MIN_TIME_MS} through ${READ_ONLY_AGGREGATE_MAX_TIME_MS}`);
  }
  return normalized;
}

export function sanitizedFailure(category: Risk001GatewayFailureCategory, error: unknown): Risk001SanitizedError {
  if (error instanceof Risk001SanitizedError) return error;
  const safeMessage = sanitizeSensitiveText(error);
  return new Risk001SanitizedError(category, safeMessage || category);
}
