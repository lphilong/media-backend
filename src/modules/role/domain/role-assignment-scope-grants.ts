import {
  Actor,
  ActorScopeGrants,
  CommissionActorScopeGrant,
  ContractRegistryActorScopeGrant,
  DashboardLiteActorScopeGrant,
  EventAssignmentActorScopeGrant,
  KpiActorScopeGrant,
  RevenueLedgerActorScopeGrant,
  TalentKpiActorScopeGrant,
  WorkScheduleActorScopeGrant,
} from "@core/actor/actor";
import { RoleValidationError } from "./role.errors";

const ASSIGNMENT_SCOPE_MODULES = [
  "workSchedule",
  "eventAssignment",
  "contractRegistry",
  "talentKpi",
  "kpi",
  "revenueLedger",
  "commission",
  "dashboardLite",
] as const;

type AssignmentScopeModule = (typeof ASSIGNMENT_SCOPE_MODULES)[number];

const ASSIGNMENT_SCOPE_MODULE_SET = new Set<string>(ASSIGNMENT_SCOPE_MODULES);

const WORK_SCHEDULE_SCOPE_ORDER: readonly WorkScheduleActorScopeGrant[] =
  Object.freeze(["self", "team", "department", "global"]);
const GLOBAL_SCOPE_ORDER = Object.freeze(["global"]);
const EVENT_ASSIGNMENT_SCOPE_ORDER: readonly EventAssignmentActorScopeGrant[] =
  Object.freeze(["global", "managedGroup"]);
const KPI_SCOPE_ORDER: readonly KpiActorScopeGrant[] = Object.freeze([
  "global",
  "managedGroup",
  "self",
]);

export function normalizeAssignmentScopeGrants(
  value: unknown,
  field = "scopeGrants",
): ActorScopeGrants | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isStrictPlainObject(value)) {
    throw new RoleValidationError(`${field} must be a plain object`);
  }

  const raw = value as Record<string, unknown>;
  const unknownKeys = Object.keys(raw).filter(
    (key) => !ASSIGNMENT_SCOPE_MODULE_SET.has(key),
  );

  if (unknownKeys.length > 0) {
    unknownKeys.sort();
    throw new RoleValidationError(
      `${field} contains unsupported module(s): ${unknownKeys.join(", ")}`,
    );
  }

  const normalized: {
    workSchedule?: readonly WorkScheduleActorScopeGrant[];
    eventAssignment?: readonly EventAssignmentActorScopeGrant[];
    contractRegistry?: readonly ContractRegistryActorScopeGrant[];
    talentKpi?: readonly TalentKpiActorScopeGrant[];
    kpi?: readonly KpiActorScopeGrant[];
    revenueLedger?: readonly RevenueLedgerActorScopeGrant[];
    commission?: readonly CommissionActorScopeGrant[];
    dashboardLite?: readonly DashboardLiteActorScopeGrant[];
  } = {};

  const workSchedule = normalizeScopeArray(
    raw.workSchedule,
    WORK_SCHEDULE_SCOPE_ORDER,
    `${field}.workSchedule`,
  );
  if (workSchedule.length > 0) {
    normalized.workSchedule = workSchedule;
  }

  const eventAssignment = normalizeScopeArray(
    raw.eventAssignment,
    EVENT_ASSIGNMENT_SCOPE_ORDER,
    `${field}.eventAssignment`,
  );
  if (eventAssignment.length > 0) {
    normalized.eventAssignment = eventAssignment;
  }

  const contractRegistry = normalizeScopeArray(
    raw.contractRegistry,
    GLOBAL_SCOPE_ORDER,
    `${field}.contractRegistry`,
  ) as readonly ContractRegistryActorScopeGrant[];
  if (contractRegistry.length > 0) {
    normalized.contractRegistry = contractRegistry;
  }

  const talentKpi = normalizeScopeArray(
    raw.talentKpi,
    GLOBAL_SCOPE_ORDER,
    `${field}.talentKpi`,
  ) as readonly TalentKpiActorScopeGrant[];
  if (talentKpi.length > 0) {
    normalized.talentKpi = talentKpi;
  }

  const kpi = normalizeScopeArray(
    raw.kpi,
    KPI_SCOPE_ORDER,
    `${field}.kpi`,
  );
  if (kpi.length > 0) {
    normalized.kpi = kpi;
  }

  const revenueLedger = normalizeScopeArray(
    raw.revenueLedger,
    GLOBAL_SCOPE_ORDER,
    `${field}.revenueLedger`,
  ) as readonly RevenueLedgerActorScopeGrant[];
  if (revenueLedger.length > 0) {
    normalized.revenueLedger = revenueLedger;
  }

  const commission = normalizeScopeArray(
    raw.commission,
    GLOBAL_SCOPE_ORDER,
    `${field}.commission`,
  ) as readonly CommissionActorScopeGrant[];
  if (commission.length > 0) {
    normalized.commission = commission;
  }

  const dashboardLite = normalizeScopeArray(
    raw.dashboardLite,
    GLOBAL_SCOPE_ORDER,
    `${field}.dashboardLite`,
  ) as readonly DashboardLiteActorScopeGrant[];
  if (dashboardLite.length > 0) {
    normalized.dashboardLite = dashboardLite;
  }

  return hasAnyScopeGrant(normalized) ? Object.freeze(normalized) : undefined;
}

export function assertActorCanGrantAssignmentScopeGrants(
  actor: Actor,
  requestedScopeGrants: ActorScopeGrants | undefined,
  field = "scopeGrants",
): void {
  if (!requestedScopeGrants) {
    return;
  }

  for (const scope of requestedScopeGrants.workSchedule ?? []) {
    if (actorCanGrantWorkScheduleScope(actor, scope)) {
      continue;
    }

    throw new RoleValidationError(
      `${field}.workSchedule contains unauthorized scope grant: ${scope}`,
    );
  }

  for (const scope of requestedScopeGrants.eventAssignment ?? []) {
    if (actorCanGrantEventAssignmentScope(actor, scope)) {
      continue;
    }

    throw new RoleValidationError(
      `${field}.eventAssignment contains unauthorized scope grant: ${scope}`,
    );
  }
  assertActorCanGrantGlobalModuleScope(
    actor,
    requestedScopeGrants.contractRegistry,
    "contractRegistry",
    field,
  );
  assertActorCanGrantGlobalModuleScope(
    actor,
    requestedScopeGrants.talentKpi,
    "talentKpi",
    field,
  );
  for (const scope of requestedScopeGrants.kpi ?? []) {
    if (actorCanGrantKpiScope(actor, scope)) {
      continue;
    }

    throw new RoleValidationError(
      `${field}.kpi contains unauthorized scope grant: ${scope}`,
    );
  }
  assertActorCanGrantGlobalModuleScope(
    actor,
    requestedScopeGrants.revenueLedger,
    "revenueLedger",
    field,
  );
  assertActorCanGrantGlobalModuleScope(
    actor,
    requestedScopeGrants.commission,
    "commission",
    field,
  );
  assertActorCanGrantGlobalModuleScope(
    actor,
    requestedScopeGrants.dashboardLite,
    "dashboardLite",
    field,
  );
}

function normalizeScopeArray<T extends string>(
  value: unknown,
  order: readonly T[],
  field: string,
): readonly T[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new RoleValidationError(`${field} must be an array of strings`);
  }

  const allowed = new Set<string>(order);
  const requested = new Set<T>();

  for (const scope of value) {
    if (typeof scope !== "string") {
      throw new RoleValidationError(`${field} must be an array of strings`);
    }

    const normalized = scope.trim();

    if (!allowed.has(normalized)) {
      throw new RoleValidationError(
        `${field} contains unsupported scope grant: ${normalized}`,
      );
    }

    requested.add(normalized as T);
  }

  return Object.freeze(order.filter((scope) => requested.has(scope)));
}

function actorCanGrantWorkScheduleScope(
  actor: Actor,
  scope: WorkScheduleActorScopeGrant,
): boolean {
  const actorScopes = actor.scopeGrants.workSchedule ?? [];

  return actorScopes.includes(scope) || actorScopes.includes("global");
}

function actorCanGrantKpiScope(
  actor: Actor,
  scope: KpiActorScopeGrant,
): boolean {
  const actorScopes = actor.scopeGrants.kpi ?? [];

  return actorScopes.includes(scope) || actorScopes.includes("global");
}

function actorCanGrantEventAssignmentScope(
  actor: Actor,
  scope: EventAssignmentActorScopeGrant,
): boolean {
  const actorScopes = actor.scopeGrants.eventAssignment ?? [];

  return actorScopes.includes(scope) || actorScopes.includes("global");
}

function assertActorCanGrantGlobalModuleScope(
  actor: Actor,
  scopes: readonly "global"[] | undefined,
  module: AssignmentScopeModule,
  field: string,
): void {
  if (!scopes || scopes.length === 0) {
    return;
  }

  const actorScopes = actor.scopeGrants[module] ?? [];

  if (actorScopes.includes("global")) {
    return;
  }

  throw new RoleValidationError(
    `${field}.${module} contains unauthorized scope grant: global`,
  );
}

function hasAnyScopeGrant(grants: ActorScopeGrants): boolean {
  return (
    (grants.workSchedule?.length ?? 0) > 0 ||
    (grants.eventAssignment?.length ?? 0) > 0 ||
    (grants.contractRegistry?.length ?? 0) > 0 ||
    (grants.talentKpi?.length ?? 0) > 0 ||
    (grants.kpi?.length ?? 0) > 0 ||
    (grants.revenueLedger?.length ?? 0) > 0 ||
    (grants.commission?.length ?? 0) > 0 ||
    (grants.dashboardLite?.length ?? 0) > 0
  );
}

function isStrictPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype;
}
