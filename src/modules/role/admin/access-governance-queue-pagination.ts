import { Collection, Document } from "mongodb";
import { RoleValidationError } from "@modules/role/domain/role.errors";
import { AccessGovernanceSourcePosition } from "./access-governance-queue-cursor";

export const GOVERNANCE_QUEUE_BATCH_SIZE = 100;
export const GOVERNANCE_QUEUE_MAXIMUM_BATCHES = 5;
export const GOVERNANCE_QUEUE_MAXIMUM_CANDIDATES =
  GOVERNANCE_QUEUE_BATCH_SIZE * GOVERNANCE_QUEUE_MAXIMUM_BATCHES;
export const GOVERNANCE_QUEUE_SERVICE_BATCHES = 1;

export interface BoundedVisibleQueuePage<TView> {
  readonly items: readonly TView[];
  readonly nextPosition: AccessGovernanceSourcePosition | null;
  readonly exhausted: boolean;
}

export interface CandidatePage<T> {
  readonly items: readonly T[];
  readonly sourceExhausted: boolean;
  readonly lastPosition: AccessGovernanceSourcePosition | null;
}

/**
 * Service reader uses one deterministic 100-candidate batch. Visibility is
 * projected immediately by the caller; an opaque continuation resumes after
 * the batch when it contains too few visible rows.
 */
export async function loadBoundedCandidates<
  T extends Document & { readonly _id: string },
>(
  collection: Collection<T>,
  baseFilter: Record<string, unknown>,
  sortField: keyof T & string,
  direction: 1 | -1,
  suppliedPosition?: AccessGovernanceSourcePosition | null,
): Promise<CandidatePage<T>> {
  const items: T[] = [];
  let position = suppliedPosition ?? null;
  let sourceExhausted = false;
  for (let batch = 0; batch < GOVERNANCE_QUEUE_SERVICE_BATCHES; batch += 1) {
    const cursorFilter = position
      ? {
          $or: [
            { [sortField]: { [direction === 1 ? "$gt" : "$lt"]: position.value } },
            { [sortField]: position.value, _id: { $gt: position.id } },
          ],
        }
      : null;
    const query = cursorFilter ? { $and: [baseFilter, cursorFilter] } : baseFilter;
    const values = (await collection
      .find(query as never)
      .sort({ [sortField]: direction, _id: 1 } as never)
      .limit(GOVERNANCE_QUEUE_BATCH_SIZE)
      .toArray()) as unknown as T[];
    items.push(...values);
    if (values.length < GOVERNANCE_QUEUE_BATCH_SIZE) {
      sourceExhausted = true;
      break;
    }
    const last = values[values.length - 1];
    if (!last) break;
    position = positionFor(last, sortField);
  }
  const last = items[items.length - 1];
  return {
    items,
    sourceExhausted,
    lastPosition: last ? positionFor(last, sortField) : position,
  };
}

export function projectVisiblePage<
  TSource extends { readonly _id: string },
  TView extends Record<string, unknown>,
>(
  source: readonly TSource[],
  projected: readonly (TView | null)[],
  pageSize: number,
  sortField: keyof TSource & string,
  candidatePage: CandidatePage<TSource>,
): {
  readonly items: readonly TView[];
  readonly meta: {
    readonly nextPosition: AccessGovernanceSourcePosition | null;
    readonly exhausted: boolean;
  };
} {
  const visible = projected
    .map((view, index) => ({ view, source: source[index] }))
    .filter(
      (item): item is { view: TView; source: TSource } =>
        item.view !== null && item.source !== undefined,
    );
  const selected = visible.slice(0, pageSize);
  const exhausted = candidatePage.sourceExhausted && visible.length <= pageSize;
  const cursorSource = selected[selected.length - 1]?.source;
  return {
    items: selected.map((item) => item.view),
    meta: {
      nextPosition: exhausted
        ? null
        : cursorSource
          ? positionFor(cursorSource, sortField)
          : candidatePage.lastPosition,
      exhausted,
    },
  };
}

export async function scanBoundedVisibleQueue<
  TSource extends Document & { readonly _id: string },
  TView extends Record<string, unknown>,
>(params: {
  readonly collection: Collection<TSource>;
  readonly baseFilter: Record<string, unknown>;
  readonly sortField: keyof TSource & string;
  readonly direction: 1 | -1;
  readonly position?: AccessGovernanceSourcePosition | null;
  readonly pageSize: number;
  readonly project: (candidate: TSource) => Promise<TView | null>;
}): Promise<BoundedVisibleQueuePage<TView>> {
  let position = params.position ?? null;
  let lastScanned: AccessGovernanceSourcePosition | null = null;
  const visible: Array<{ readonly view: TView; readonly position: AccessGovernanceSourcePosition }> = [];

  for (let batchNumber = 0; batchNumber < GOVERNANCE_QUEUE_MAXIMUM_BATCHES; batchNumber += 1) {
    const cursorFilter = position
      ? {
          $or: [
            {
              [params.sortField]: {
                [params.direction === 1 ? "$gt" : "$lt"]: position.value,
              },
            },
            { [params.sortField]: position.value, _id: { $gt: position.id } },
          ],
        }
      : null;
    const query = cursorFilter
      ? { $and: [params.baseFilter, cursorFilter] }
      : params.baseFilter;
    const batch = (await params.collection
      .find(query as never)
      .sort({ [params.sortField]: params.direction, _id: 1 } as never)
      .limit(GOVERNANCE_QUEUE_BATCH_SIZE)
      .toArray()) as unknown as TSource[];

    for (const candidate of batch) {
      const candidatePosition = positionFor(candidate, params.sortField);
      lastScanned = candidatePosition;
      const view = await params.project(candidate);
      if (view) visible.push({ view, position: candidatePosition });
      if (visible.length > params.pageSize) {
        const selected = visible.slice(0, params.pageSize);
        return {
          items: selected.map((item) => item.view),
          nextPosition: selected[selected.length - 1]?.position ?? lastScanned,
          exhausted: false,
        };
      }
    }

    if (batch.length < GOVERNANCE_QUEUE_BATCH_SIZE) {
      return {
        items: visible.map((item) => item.view),
        nextPosition: null,
        exhausted: true,
      };
    }
    position = lastScanned;
  }

  return {
    items: visible.map((item) => item.view),
    nextPosition: lastScanned,
    exhausted: false,
  };
}

export function normalizeQueueLimit(value: number | undefined): number {
  if (value === undefined) return 25;
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw new RoleValidationError("queue limit must be an integer from 1 to 50");
  }
  return value;
}

function positionFor<T extends { readonly _id: string }>(
  record: T,
  sortField: keyof T & string,
): AccessGovernanceSourcePosition {
  const value = record[sortField];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RoleValidationError("QUEUE_CURSOR_SOURCE_INVALID");
  }
  return { value, id: record._id };
}
