import crypto from "crypto";

export const MIGRATION_CLASSIFICATIONS = [
  "DETERMINISTIC_AUTO_MIGRATION",
  "DETERMINISTIC_WITH_PRECONDITION",
  "AMBIGUOUS_MANUAL_REVIEW",
  "UNMIGRATABLE_WITHOUT_OWNER_DECISION",
  "HISTORICAL_UNKNOWN_PRESERVE_AS_UNKNOWN",
  "NO_MIGRATION_REQUIRED",
] as const;

export type MigrationClassification = (typeof MIGRATION_CLASSIFICATIONS)[number];

export interface MigrationDescriptor<TInput = unknown> {
  readonly id: string;
  readonly version: number;
  readonly dependencies: readonly string[];
  readonly recordClass: string;
  readonly plan: (input: TInput) => readonly PlannedMigrationAction[];
}

export interface PlannedMigrationAction {
  readonly migrationId: string;
  readonly migrationVersion: number;
  readonly recordClass: string;
  readonly sanitizedRecordIdentity: string;
  readonly currentStateSummary: Readonly<Record<string, unknown>>;
  readonly proposedAction: string;
  readonly preconditions: readonly string[];
  readonly dependencyChecks: readonly string[];
  readonly expectedEffect: string;
  readonly reasonCode: string;
  readonly classification: MigrationClassification;
  readonly requiredApproval: "NONE" | "SOURCE_AUDIT" | "OWNER";
  readonly sourceRemovalDependency: string;
  readonly beforeFingerprint: string;
  readonly plannedAfter: Readonly<Record<string, unknown>>;
  readonly plannedAfterFingerprint: string;
}

export interface MigrationManifest {
  readonly mode: "DRY_RUN";
  readonly generatedFromFingerprint: string;
  readonly orderedMigrations: readonly string[];
  readonly actions: readonly PlannedMigrationAction[];
  readonly counts: Readonly<Record<MigrationClassification, number>>;
  readonly writeExecutorStatus:
    "NOT_IMPLEMENTED_OR_NOT_ENABLED_PENDING_APPROVED_DRY_RUN";
}

export class MigrationRegistry {
  private readonly entries = new Map<string, MigrationDescriptor<unknown>>();

  register<TInput>(descriptor: MigrationDescriptor<TInput>): this {
    const key = migrationKey(descriptor.id, descriptor.version);
    if (this.entries.has(key)) {
      throw new Error(`Duplicate migration registration: ${key}`);
    }
    this.entries.set(key, descriptor as MigrationDescriptor<unknown>);
    return this;
  }

  ordered(): readonly MigrationDescriptor<unknown>[] {
    const byId = new Map([...this.entries.values()].map((item) => [item.id, item]));
    const ordered: MigrationDescriptor<unknown>[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (item: MigrationDescriptor<unknown>): void => {
      if (visited.has(item.id)) return;
      if (visiting.has(item.id)) throw new Error(`Migration dependency cycle: ${item.id}`);
      visiting.add(item.id);
      for (const dependencyId of [...item.dependencies].sort()) {
        const dependency = byId.get(dependencyId);
        if (!dependency) {
          throw new Error(`Missing migration dependency ${dependencyId} for ${item.id}`);
        }
        visit(dependency);
      }
      visiting.delete(item.id);
      visited.add(item.id);
      ordered.push(item);
    };
    [...this.entries.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .forEach(visit);
    return Object.freeze(ordered);
  }
}

export function buildDryRunManifest(params: {
  readonly registry: MigrationRegistry;
  readonly inputs: Readonly<Record<string, unknown>>;
}): MigrationManifest {
  const ordered = params.registry.ordered();
  const actions = ordered.flatMap((migration) =>
    migration.plan(params.inputs[migration.id]).map((action) => freezeAction(action)),
  );
  const sortedActions = [...actions].sort((left, right) =>
    [left.migrationId, left.sanitizedRecordIdentity, left.reasonCode].join("|").localeCompare(
      [right.migrationId, right.sanitizedRecordIdentity, right.reasonCode].join("|"),
    ),
  );
  const counts = Object.fromEntries(
    MIGRATION_CLASSIFICATIONS.map((classification) => [
      classification,
      new Set(
        sortedActions
          .filter((action) => action.classification === classification)
          .map((action) => action.sanitizedRecordIdentity),
      ).size,
    ]),
  ) as Record<MigrationClassification, number>;
  return Object.freeze({
    mode: "DRY_RUN",
    generatedFromFingerprint: stableFingerprint(params.inputs),
    orderedMigrations: Object.freeze(ordered.map((item) => item.id)),
    actions: Object.freeze(sortedActions),
    counts: Object.freeze(counts),
    writeExecutorStatus: "NOT_IMPLEMENTED_OR_NOT_ENABLED_PENDING_APPROVED_DRY_RUN",
  });
}

export function plannedAction(params: Omit<PlannedMigrationAction, "beforeFingerprint" | "plannedAfter" | "plannedAfterFingerprint"> & {
  readonly before: unknown;
  readonly plannedAfter: Readonly<Record<string, unknown>>;
}): PlannedMigrationAction {
  const { before, plannedAfter, ...contract } = params;
  return freezeAction({
    ...contract,
    beforeFingerprint: stableFingerprint(before),
    plannedAfter: Object.freeze({ ...plannedAfter }),
    plannedAfterFingerprint: stableFingerprint(plannedAfter),
  });
}

export function sanitizedIdentity(recordClass: string, identity: string): string {
  const digest = crypto.createHash("sha256").update(identity.trim(), "utf8").digest("hex");
  return `${recordClass}:${digest.slice(0, 16)}`;
}

export function stableFingerprint(value: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function migrationKey(id: string, version: number): string {
  if (!/^[A-Z0-9][A-Z0-9_-]+$/u.test(id) || !Number.isInteger(version) || version < 1) {
    throw new Error(`Invalid migration identity: ${id}@${version}`);
  }
  return `${id}@${version}`;
}

function freezeAction(action: PlannedMigrationAction): PlannedMigrationAction {
  return Object.freeze({
    ...action,
    currentStateSummary: Object.freeze({ ...action.currentStateSummary }),
    plannedAfter: Object.freeze({ ...action.plannedAfter }),
    preconditions: Object.freeze([...action.preconditions]),
    dependencyChecks: Object.freeze([...action.dependencyChecks]),
  });
}
