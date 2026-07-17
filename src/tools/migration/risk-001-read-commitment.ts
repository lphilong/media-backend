import crypto from "node:crypto";
import { stableSerializeRisk001QueryValue } from "./risk-001-query-value-contract";

/** Database-free captured-read commitment used by the RISK-001 loaders. */
export interface Risk001ReadCommitment {
  readonly collection: string;
  readonly inspectedCount: number;
  readonly matchedCount: number;
  readonly filterFingerprint: string;
  readonly projectionFingerprint: string;
  readonly queryIdentityFingerprint: string;
  readonly sourceStateFingerprint: string;
  readonly firstIdentity: string | null;
  readonly lastIdentity: string | null;
}

export interface Risk001ReadCommitmentInput {
  readonly collection: string;
  readonly filter: Readonly<Record<string, unknown>>;
  readonly projection: Readonly<Record<string, 0 | 1>>;
  readonly pageSize: number;
  readonly safetyCeiling: number;
  readonly rows: readonly object[];
  readonly inspectedCount: number;
  readonly matchedCount: number;
}

export interface Risk001ReadCommitmentMismatch {
  readonly code: "SOURCE_STATE_CHANGED_DURING_DRY_RUN";
  readonly collection: string;
}

export interface Risk001ReadQueryIdentity {
  readonly filterFingerprint: string;
  readonly projectionFingerprint: string;
  readonly queryIdentityFingerprint: string;
}

export function createRisk001ReadQueryIdentity(
  collection: string,
  filter: Readonly<Record<string, unknown>>,
  projection: Readonly<Record<string, 0 | 1>>,
  pageSize: number,
  safetyCeiling: number,
): Risk001ReadQueryIdentity {
  if (typeof collection !== "string" || collection.length === 0) {
    throw new Error("Invalid collection identity");
  }
  const filterFingerprint = sha256(stableSerializeRisk001QueryValue(filter));
  const projectionFingerprint = sha256(stableSerializeRisk001QueryValue(projection));
  return Object.freeze({
    filterFingerprint,
    projectionFingerprint,
    queryIdentityFingerprint: sha256(stableSerializeRisk001QueryValue({
      collection,
      filterFingerprint,
      projectionFingerprint,
      pageSize,
      safetyCeiling,
    })),
  });
}

export function createRisk001ReadCommitment(input: Risk001ReadCommitmentInput): Risk001ReadCommitment {
  const { filterFingerprint, projectionFingerprint, queryIdentityFingerprint } = createRisk001ReadQueryIdentity(
    input.collection,
    input.filter,
    input.projection,
    input.pageSize,
    input.safetyCeiling,
  );
  const projectedRows = input.rows.map((row) => Object.fromEntries(
    Object.keys(input.projection)
      .filter((field) => input.projection[field] === 1 && Object.prototype.hasOwnProperty.call(row, field))
      .map((field) => [field, (row as Record<string, unknown>)[field]]),
  ));
  const identities = projectedRows.map(readProjectedIdentity);
  return Object.freeze({
    collection: input.collection,
    inspectedCount: input.inspectedCount,
    matchedCount: input.matchedCount,
    filterFingerprint,
    projectionFingerprint,
    queryIdentityFingerprint,
    sourceStateFingerprint: sha256(stableSerializeRisk001QueryValue({ queryIdentityFingerprint, count: projectedRows })),
    firstIdentity: identities.length > 0 ? sha256(identities[0]!) : null,
    lastIdentity: identities.length > 0 ? sha256(identities[identities.length - 1]!) : null,
  });
}

/** Returns only a sanitized classification; never exposes source records or field values. */
export function verifyRisk001ReadCommitment(
  captured: Risk001ReadCommitment,
  verified: Risk001ReadCommitment,
): Risk001ReadCommitmentMismatch | null {
  if (
    captured.collection !== verified.collection ||
    captured.inspectedCount !== verified.inspectedCount ||
    captured.matchedCount !== verified.matchedCount ||
    captured.filterFingerprint !== verified.filterFingerprint ||
    captured.projectionFingerprint !== verified.projectionFingerprint ||
    captured.queryIdentityFingerprint !== verified.queryIdentityFingerprint ||
    captured.sourceStateFingerprint !== verified.sourceStateFingerprint ||
    captured.firstIdentity !== verified.firstIdentity ||
    captured.lastIdentity !== verified.lastIdentity
  ) {
    return Object.freeze({ code: "SOURCE_STATE_CHANGED_DURING_DRY_RUN", collection: captured.collection });
  }
  return null;
}

function readProjectedIdentity(row: object): string {
  const id = (row as { readonly _id?: unknown })._id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Projected record identity must be a non-empty string");
  }
  return id;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}
