import { SystemInvariantError } from "@core/error/system-error";
import { ContextType } from "@core/context/context.types";

export type ActorType = "admin" | "staff" | "customer" | "public" | "system";
export type WorkScheduleActorScopeGrant =
  | "self"
  | "team"
  | "department"
  | "global";
export type EventAssignmentActorScopeGrant =
  | "global"
  | "managedGroup";
export type ContractRegistryActorScopeGrant =
  | "global";
export type TalentKpiActorScopeGrant =
  | "global";
export type KpiActorScopeGrant =
  | "global"
  | "managedGroup"
  | "self";
export type RevenueLedgerActorScopeGrant =
  | "global";
export type CommissionActorScopeGrant =
  | "global";
export type DashboardLiteActorScopeGrant =
  | "global";

export interface ActorScopeGrants {
  readonly workSchedule?: readonly WorkScheduleActorScopeGrant[];
  readonly eventAssignment?: readonly EventAssignmentActorScopeGrant[];
  readonly contractRegistry?: readonly ContractRegistryActorScopeGrant[];
  readonly talentKpi?: readonly TalentKpiActorScopeGrant[];
  readonly kpi?: readonly KpiActorScopeGrant[];
  readonly revenueLedger?: readonly RevenueLedgerActorScopeGrant[];
  readonly commission?: readonly CommissionActorScopeGrant[];
  readonly dashboardLite?: readonly DashboardLiteActorScopeGrant[];
}

const WORK_SCHEDULE_SCOPE_GRANTS_ORDER: readonly WorkScheduleActorScopeGrant[] =
  Object.freeze([
    "self",
    "team",
    "department",
    "global",
  ]);

const WORK_SCHEDULE_SCOPE_GRANT_SET = new Set<
  WorkScheduleActorScopeGrant
>(WORK_SCHEDULE_SCOPE_GRANTS_ORDER);

const EVENT_ASSIGNMENT_SCOPE_GRANTS_ORDER: readonly EventAssignmentActorScopeGrant[] =
  Object.freeze(["global", "managedGroup"]);

const EVENT_ASSIGNMENT_SCOPE_GRANT_SET = new Set<
  EventAssignmentActorScopeGrant
>(EVENT_ASSIGNMENT_SCOPE_GRANTS_ORDER);

const CONTRACT_REGISTRY_SCOPE_GRANTS_ORDER: readonly ContractRegistryActorScopeGrant[] =
  Object.freeze(["global"]);

const CONTRACT_REGISTRY_SCOPE_GRANT_SET = new Set<
  ContractRegistryActorScopeGrant
>(CONTRACT_REGISTRY_SCOPE_GRANTS_ORDER);

const TALENT_KPI_SCOPE_GRANTS_ORDER: readonly TalentKpiActorScopeGrant[] =
  Object.freeze(["global"]);

const TALENT_KPI_SCOPE_GRANT_SET = new Set<
  TalentKpiActorScopeGrant
>(TALENT_KPI_SCOPE_GRANTS_ORDER);

const KPI_SCOPE_GRANTS_ORDER: readonly KpiActorScopeGrant[] =
  Object.freeze([
    "global",
    "managedGroup",
    "self",
  ]);

const KPI_SCOPE_GRANT_SET = new Set<KpiActorScopeGrant>(
  KPI_SCOPE_GRANTS_ORDER,
);

const REVENUE_LEDGER_SCOPE_GRANTS_ORDER: readonly RevenueLedgerActorScopeGrant[] =
  Object.freeze(["global"]);

const REVENUE_LEDGER_SCOPE_GRANT_SET = new Set<
  RevenueLedgerActorScopeGrant
>(REVENUE_LEDGER_SCOPE_GRANTS_ORDER);

const COMMISSION_SCOPE_GRANTS_ORDER: readonly CommissionActorScopeGrant[] =
  Object.freeze(["global"]);

const COMMISSION_SCOPE_GRANT_SET = new Set<
  CommissionActorScopeGrant
>(COMMISSION_SCOPE_GRANTS_ORDER);

const DASHBOARD_LITE_SCOPE_GRANTS_ORDER: readonly DashboardLiteActorScopeGrant[] =
  Object.freeze(["global"]);

const DASHBOARD_LITE_SCOPE_GRANT_SET = new Set<
  DashboardLiteActorScopeGrant
>(DASHBOARD_LITE_SCOPE_GRANTS_ORDER);

export interface ActorTrace {
  readonly ip?: string;
  readonly userAgent?: string;
  readonly requestId?: string;
}

/**
 * Roles are NON-AUTHORITATIVE.
 * They MUST NOT be used for permission enforcement.
 */
export class Actor {
  readonly id: string;
  readonly type: ActorType;
  readonly context: ContextType;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly scopeGrants: Readonly<ActorScopeGrants>;
  readonly trace?: ActorTrace;
  readonly isActive: boolean;

  constructor(params: {
    id: string;
    type: ActorType;
    context: ContextType;
    roles: readonly string[];
    permissions: readonly string[];
    scopeGrants?: ActorScopeGrants;
    trace?: ActorTrace;
    isActive: boolean;
  }) {
    if (!params.id) {
      throw new SystemInvariantError(
        "ACTOR_INVALID_PAYLOAD",
        "Invalid actor id",
      );
    }

    this.id = params.id;
    this.type = params.type;
    this.context = params.context;
    this.roles = Object.freeze([...params.roles]);
    this.permissions = Object.freeze([...params.permissions]);
    this.scopeGrants = normalizeActorScopeGrants(
      params.scopeGrants,
    );
    this.trace = params.trace;
    this.isActive = params.isActive;

    Object.freeze(this);
  }
}

function normalizeActorScopeGrants(
  grants: ActorScopeGrants | undefined,
): Readonly<ActorScopeGrants> {
  if (!grants) {
    return Object.freeze({});
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

  if (grants.workSchedule !== undefined) {
    if (!Array.isArray(grants.workSchedule)) {
      throw new SystemInvariantError(
        "ACTOR_INVALID_PAYLOAD",
        "Actor workSchedule scope grants must be an array",
      );
    }

    const requestedScopes = new Set<WorkScheduleActorScopeGrant>();

    for (const scope of grants.workSchedule) {
      if (
        !WORK_SCHEDULE_SCOPE_GRANT_SET.has(
          scope as WorkScheduleActorScopeGrant,
        )
      ) {
        throw new SystemInvariantError(
          "ACTOR_INVALID_PAYLOAD",
          "Actor workSchedule scope grants contain unsupported value",
        );
      }

      requestedScopes.add(
        scope as WorkScheduleActorScopeGrant,
      );
    }

    normalized.workSchedule = Object.freeze(
      WORK_SCHEDULE_SCOPE_GRANTS_ORDER.filter(
        (scope) => requestedScopes.has(scope),
      ),
    );
  }

  if (grants.eventAssignment !== undefined) {
    if (!Array.isArray(grants.eventAssignment)) {
      throw new SystemInvariantError(
        "ACTOR_INVALID_PAYLOAD",
        "Actor eventAssignment scope grants must be an array",
      );
    }

    const requestedScopes =
      new Set<EventAssignmentActorScopeGrant>();

    for (const scope of grants.eventAssignment) {
      if (
        !EVENT_ASSIGNMENT_SCOPE_GRANT_SET.has(
          scope as EventAssignmentActorScopeGrant,
        )
      ) {
        throw new SystemInvariantError(
          "ACTOR_INVALID_PAYLOAD",
          "Actor eventAssignment scope grants contain unsupported value",
        );
      }

      requestedScopes.add(
        scope as EventAssignmentActorScopeGrant,
      );
    }

    normalized.eventAssignment = Object.freeze(
      EVENT_ASSIGNMENT_SCOPE_GRANTS_ORDER.filter(
        (scope) => requestedScopes.has(scope),
      ),
    );
  }

  if (grants.contractRegistry !== undefined) {
    if (!Array.isArray(grants.contractRegistry)) {
      throw new SystemInvariantError(
        "ACTOR_INVALID_PAYLOAD",
        "Actor contractRegistry scope grants must be an array",
      );
    }

    const requestedScopes =
      new Set<ContractRegistryActorScopeGrant>();

    for (const scope of grants.contractRegistry) {
      if (
        !CONTRACT_REGISTRY_SCOPE_GRANT_SET.has(
          scope as ContractRegistryActorScopeGrant,
        )
      ) {
        throw new SystemInvariantError(
          "ACTOR_INVALID_PAYLOAD",
          "Actor contractRegistry scope grants contain unsupported value",
        );
      }

      requestedScopes.add(
        scope as ContractRegistryActorScopeGrant,
      );
    }

    normalized.contractRegistry = Object.freeze(
      CONTRACT_REGISTRY_SCOPE_GRANTS_ORDER.filter(
        (scope) => requestedScopes.has(scope),
      ),
    );
  }

  if (grants.talentKpi !== undefined) {
    if (!Array.isArray(grants.talentKpi)) {
      throw new SystemInvariantError(
        "ACTOR_INVALID_PAYLOAD",
        "Actor talentKpi scope grants must be an array",
      );
    }

    const requestedScopes = new Set<TalentKpiActorScopeGrant>();

    for (const scope of grants.talentKpi) {
      if (
        !TALENT_KPI_SCOPE_GRANT_SET.has(
          scope as TalentKpiActorScopeGrant,
        )
      ) {
        throw new SystemInvariantError(
          "ACTOR_INVALID_PAYLOAD",
          "Actor talentKpi scope grants contain unsupported value",
        );
      }

      requestedScopes.add(
        scope as TalentKpiActorScopeGrant,
      );
    }

    normalized.talentKpi = Object.freeze(
      TALENT_KPI_SCOPE_GRANTS_ORDER.filter(
        (scope) => requestedScopes.has(scope),
      ),
    );
  }

  if (grants.kpi !== undefined) {
    if (!Array.isArray(grants.kpi)) {
      throw new SystemInvariantError(
        "ACTOR_INVALID_PAYLOAD",
        "Actor kpi scope grants must be an array",
      );
    }

    const requestedScopes = new Set<KpiActorScopeGrant>();

    for (const scope of grants.kpi) {
      if (!KPI_SCOPE_GRANT_SET.has(scope as KpiActorScopeGrant)) {
        throw new SystemInvariantError(
          "ACTOR_INVALID_PAYLOAD",
          "Actor kpi scope grants contain unsupported value",
        );
      }

      requestedScopes.add(scope as KpiActorScopeGrant);
    }

    normalized.kpi = Object.freeze(
      KPI_SCOPE_GRANTS_ORDER.filter((scope) =>
        requestedScopes.has(scope),
      ),
    );
  }

  if (grants.revenueLedger !== undefined) {
    if (!Array.isArray(grants.revenueLedger)) {
      throw new SystemInvariantError(
        "ACTOR_INVALID_PAYLOAD",
        "Actor revenueLedger scope grants must be an array",
      );
    }

    const requestedScopes =
      new Set<RevenueLedgerActorScopeGrant>();

    for (const scope of grants.revenueLedger) {
      if (
        !REVENUE_LEDGER_SCOPE_GRANT_SET.has(
          scope as RevenueLedgerActorScopeGrant,
        )
      ) {
        throw new SystemInvariantError(
          "ACTOR_INVALID_PAYLOAD",
          "Actor revenueLedger scope grants contain unsupported value",
        );
      }

      requestedScopes.add(
        scope as RevenueLedgerActorScopeGrant,
      );
    }

    normalized.revenueLedger = Object.freeze(
      REVENUE_LEDGER_SCOPE_GRANTS_ORDER.filter(
        (scope) => requestedScopes.has(scope),
      ),
    );
  }

  if (grants.commission !== undefined) {
    if (!Array.isArray(grants.commission)) {
      throw new SystemInvariantError(
        "ACTOR_INVALID_PAYLOAD",
        "Actor commission scope grants must be an array",
      );
    }

    const requestedScopes =
      new Set<CommissionActorScopeGrant>();

    for (const scope of grants.commission) {
      if (
        !COMMISSION_SCOPE_GRANT_SET.has(
          scope as CommissionActorScopeGrant,
        )
      ) {
        throw new SystemInvariantError(
          "ACTOR_INVALID_PAYLOAD",
          "Actor commission scope grants contain unsupported value",
        );
      }

      requestedScopes.add(
        scope as CommissionActorScopeGrant,
      );
    }

    normalized.commission = Object.freeze(
      COMMISSION_SCOPE_GRANTS_ORDER.filter(
        (scope) => requestedScopes.has(scope),
      ),
    );
  }

  if (grants.dashboardLite !== undefined) {
    if (!Array.isArray(grants.dashboardLite)) {
      throw new SystemInvariantError(
        "ACTOR_INVALID_PAYLOAD",
        "Actor dashboardLite scope grants must be an array",
      );
    }

    const requestedScopes =
      new Set<DashboardLiteActorScopeGrant>();

    for (const scope of grants.dashboardLite) {
      if (
        !DASHBOARD_LITE_SCOPE_GRANT_SET.has(
          scope as DashboardLiteActorScopeGrant,
        )
      ) {
        throw new SystemInvariantError(
          "ACTOR_INVALID_PAYLOAD",
          "Actor dashboardLite scope grants contain unsupported value",
        );
      }

      requestedScopes.add(
        scope as DashboardLiteActorScopeGrant,
      );
    }

    normalized.dashboardLite = Object.freeze(
      DASHBOARD_LITE_SCOPE_GRANTS_ORDER.filter(
        (scope) => requestedScopes.has(scope),
      ),
    );
  }

  return Object.freeze(normalized);
}
