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
} from "../actor/actor";
import { PermissionContract } from "./permission.contract";
import { Permission } from "./permission.enum";
import { SystemInvariantError } from "../error/system-error";

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

const WORK_SCHEDULE_BASELINE_SCOPE_GRANTS: readonly WorkScheduleActorScopeGrant[] =
  Object.freeze([
    "self",
    "team",
    "department",
  ]);

const WORK_SCHEDULE_ACTION_PERMISSIONS = new Set<
  string
>([
  Permission.WORK_SCHEDULE_READ,
  Permission.WORK_SCHEDULE_CREATE,
  Permission.WORK_SCHEDULE_UPDATE,
  Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
]);

const EVENT_ASSIGNMENT_SCOPE_GRANTS_ORDER: readonly EventAssignmentActorScopeGrant[] =
  Object.freeze(["global"]);

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
  Object.freeze(["global", "managedGroup", "self"]);

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

export function deriveActorScopeGrantsFromPermissions(
  permissions: readonly string[],
): Readonly<ActorScopeGrants> {
  const hasAnyWorkScheduleActionPermission =
    permissions.some((permission) =>
      WORK_SCHEDULE_ACTION_PERMISSIONS.has(
        permission,
      ),
    );
  if (!hasAnyWorkScheduleActionPermission) {
    return Object.freeze({});
  }

  const derived: {
    workSchedule?: readonly WorkScheduleActorScopeGrant[];
  } = {};

  derived.workSchedule = Object.freeze([
    ...WORK_SCHEDULE_BASELINE_SCOPE_GRANTS,
  ]);
  return Object.freeze(derived);
}

export class PermissionGuard {
  static assertAdminActor(
    actor: Actor | undefined,
  ): asserts actor is Actor {
    this.assertActorPresentAndActive(actor);

    if (actor.type === "admin") {
      return;
    }

    throw new SystemInvariantError(
      "PERMISSION_DENIED",
      `Admin access requires actor.type admin, received ${actor.type}`,
    );
  }

  static assert(actor: Actor, contract: PermissionContract): void {
    this.assertActorPresentAndActive(actor);

    /**
     * Context must always match.
     * No implicit cross-context permission.
     */
    if (actor.context !== contract.context) {
      throw new SystemInvariantError(
        "PERMISSION_CONTEXT_VIOLATION",
        `Permission ${contract.code} not allowed in ${actor.context}`
      );
    }

    /**
     * SYSTEM actor is NOT a bypass.
     * All actors must have explicit permission.
     */
    if (!actor.permissions.includes(contract.code)) {
      throw new SystemInvariantError(
        "PERMISSION_DENIED",
        `Missing permission ${contract.code}`
      );
    }
  }

  static resolveWorkScheduleScopeGrants(
    actor: Actor,
  ): readonly WorkScheduleActorScopeGrant[] {
    this.assertActorPresentAndActive(actor);

    const declared =
      actor.scopeGrants.workSchedule;
    const fallbackDerived =
      deriveActorScopeGrantsFromPermissions(
        actor.permissions,
      ).workSchedule ?? [];

    if (!declared) {
      return fallbackDerived;
    }

    return normalizeWorkScheduleScopeGrants(
      declared,
    );
  }

  static hasWorkScheduleScopeGrant(
    actor: Actor,
    scope: WorkScheduleActorScopeGrant,
  ): boolean {
    return this.resolveWorkScheduleScopeGrants(
      actor,
    ).includes(scope);
  }

  static resolveEventAssignmentScopeGrants(
    actor: Actor,
  ): readonly EventAssignmentActorScopeGrant[] {
    this.assertActorPresentAndActive(actor);

    const declared =
      actor.scopeGrants.eventAssignment;
    if (!declared) {
      return [];
    }

    return normalizeEventAssignmentScopeGrants(
      declared,
    );
  }

  static hasEventAssignmentScopeGrant(
    actor: Actor,
    scope: EventAssignmentActorScopeGrant,
  ): boolean {
    return this.resolveEventAssignmentScopeGrants(
      actor,
    ).includes(scope);
  }

  static resolveContractRegistryScopeGrants(
    actor: Actor,
  ): readonly ContractRegistryActorScopeGrant[] {
    this.assertActorPresentAndActive(actor);

    const declared =
      actor.scopeGrants.contractRegistry;
    if (!declared) {
      return [];
    }

    return normalizeContractRegistryScopeGrants(
      declared,
    );
  }

  static hasContractRegistryScopeGrant(
    actor: Actor,
    scope: ContractRegistryActorScopeGrant,
  ): boolean {
    return this.resolveContractRegistryScopeGrants(
      actor,
    ).includes(scope);
  }

  static resolveTalentKpiScopeGrants(
    actor: Actor,
  ): readonly TalentKpiActorScopeGrant[] {
    this.assertActorPresentAndActive(actor);

    const declared = actor.scopeGrants.talentKpi;
    if (!declared) {
      return [];
    }

    return normalizeTalentKpiScopeGrants(
      declared,
    );
  }

  static hasTalentKpiScopeGrant(
    actor: Actor,
    scope: TalentKpiActorScopeGrant,
  ): boolean {
    return this.resolveTalentKpiScopeGrants(
      actor,
    ).includes(scope);
  }

  static resolveKpiScopeGrants(
    actor: Actor,
  ): readonly KpiActorScopeGrant[] {
    this.assertActorPresentAndActive(actor);

    const declared = actor.scopeGrants.kpi;
    if (!declared) {
      return [];
    }

    return normalizeKpiScopeGrants(declared);
  }

  static hasKpiScopeGrant(
    actor: Actor,
    scope: KpiActorScopeGrant,
  ): boolean {
    return this.resolveKpiScopeGrants(actor).includes(scope);
  }

  static resolveRevenueLedgerScopeGrants(
    actor: Actor,
  ): readonly RevenueLedgerActorScopeGrant[] {
    this.assertActorPresentAndActive(actor);

    const declared =
      actor.scopeGrants.revenueLedger;
    if (!declared) {
      return [];
    }

    return normalizeRevenueLedgerScopeGrants(
      declared,
    );
  }

  static hasRevenueLedgerScopeGrant(
    actor: Actor,
    scope: RevenueLedgerActorScopeGrant,
  ): boolean {
    return this.resolveRevenueLedgerScopeGrants(
      actor,
    ).includes(scope);
  }

  static resolveCommissionScopeGrants(
    actor: Actor,
  ): readonly CommissionActorScopeGrant[] {
    this.assertActorPresentAndActive(actor);

    const declared = actor.scopeGrants.commission;
    if (!declared) {
      return [];
    }

    return normalizeCommissionScopeGrants(
      declared,
    );
  }

  static hasCommissionScopeGrant(
    actor: Actor,
    scope: CommissionActorScopeGrant,
  ): boolean {
    return this.resolveCommissionScopeGrants(
      actor,
    ).includes(scope);
  }

  static resolveDashboardLiteScopeGrants(
    actor: Actor,
  ): readonly DashboardLiteActorScopeGrant[] {
    this.assertActorPresentAndActive(actor);

    const declared =
      actor.scopeGrants.dashboardLite;
    if (!declared) {
      return [];
    }

    return normalizeDashboardLiteScopeGrants(
      declared,
    );
  }

  static hasDashboardLiteScopeGrant(
    actor: Actor,
    scope: DashboardLiteActorScopeGrant,
  ): boolean {
    return this.resolveDashboardLiteScopeGrants(
      actor,
    ).includes(scope);
  }

  private static assertActorPresentAndActive(
    actor: Actor | undefined,
  ): asserts actor is Actor {
    if (!actor) {
      throw new SystemInvariantError(
        "ACTOR_MISSING",
        "Actor must be provided"
      );
    }

    if (!actor.isActive) {
      throw new SystemInvariantError(
        "ACTOR_INACTIVE",
        "Inactive actor"
      );
    }
  }
}

function normalizeWorkScheduleScopeGrants(
  scopes: readonly WorkScheduleActorScopeGrant[],
): readonly WorkScheduleActorScopeGrant[] {
  const normalized = new Set<WorkScheduleActorScopeGrant>();

  for (const scope of scopes) {
    if (
      WORK_SCHEDULE_SCOPE_GRANT_SET.has(scope)
    ) {
      normalized.add(scope);
    }
  }

  return WORK_SCHEDULE_SCOPE_GRANTS_ORDER.filter(
    (scope) => normalized.has(scope),
  );
}

function normalizeEventAssignmentScopeGrants(
  scopes: readonly EventAssignmentActorScopeGrant[],
): readonly EventAssignmentActorScopeGrant[] {
  const normalized =
    new Set<EventAssignmentActorScopeGrant>();

  for (const scope of scopes) {
    if (
      EVENT_ASSIGNMENT_SCOPE_GRANT_SET.has(scope)
    ) {
      normalized.add(scope);
    }
  }

  return EVENT_ASSIGNMENT_SCOPE_GRANTS_ORDER.filter(
    (scope) => normalized.has(scope),
  );
}

function normalizeContractRegistryScopeGrants(
  scopes: readonly ContractRegistryActorScopeGrant[],
): readonly ContractRegistryActorScopeGrant[] {
  const normalized =
    new Set<ContractRegistryActorScopeGrant>();

  for (const scope of scopes) {
    if (
      CONTRACT_REGISTRY_SCOPE_GRANT_SET.has(scope)
    ) {
      normalized.add(scope);
    }
  }

  return CONTRACT_REGISTRY_SCOPE_GRANTS_ORDER.filter(
    (scope) => normalized.has(scope),
  );
}

function normalizeTalentKpiScopeGrants(
  scopes: readonly TalentKpiActorScopeGrant[],
): readonly TalentKpiActorScopeGrant[] {
  const normalized = new Set<TalentKpiActorScopeGrant>();

  for (const scope of scopes) {
    if (
      TALENT_KPI_SCOPE_GRANT_SET.has(scope)
    ) {
      normalized.add(scope);
    }
  }

  return TALENT_KPI_SCOPE_GRANTS_ORDER.filter(
    (scope) => normalized.has(scope),
  );
}

function normalizeKpiScopeGrants(
  scopes: readonly KpiActorScopeGrant[],
): readonly KpiActorScopeGrant[] {
  const normalized = new Set<KpiActorScopeGrant>();

  for (const scope of scopes) {
    if (KPI_SCOPE_GRANT_SET.has(scope)) {
      normalized.add(scope);
    }
  }

  return KPI_SCOPE_GRANTS_ORDER.filter((scope) =>
    normalized.has(scope),
  );
}

function normalizeRevenueLedgerScopeGrants(
  scopes: readonly RevenueLedgerActorScopeGrant[],
): readonly RevenueLedgerActorScopeGrant[] {
  const normalized =
    new Set<RevenueLedgerActorScopeGrant>();

  for (const scope of scopes) {
    if (
      REVENUE_LEDGER_SCOPE_GRANT_SET.has(scope)
    ) {
      normalized.add(scope);
    }
  }

  return REVENUE_LEDGER_SCOPE_GRANTS_ORDER.filter(
    (scope) => normalized.has(scope),
  );
}

function normalizeCommissionScopeGrants(
  scopes: readonly CommissionActorScopeGrant[],
): readonly CommissionActorScopeGrant[] {
  const normalized =
    new Set<CommissionActorScopeGrant>();

  for (const scope of scopes) {
    if (
      COMMISSION_SCOPE_GRANT_SET.has(scope)
    ) {
      normalized.add(scope);
    }
  }

  return COMMISSION_SCOPE_GRANTS_ORDER.filter(
    (scope) => normalized.has(scope),
  );
}

function normalizeDashboardLiteScopeGrants(
  scopes: readonly DashboardLiteActorScopeGrant[],
): readonly DashboardLiteActorScopeGrant[] {
  const normalized =
    new Set<DashboardLiteActorScopeGrant>();

  for (const scope of scopes) {
    if (
      DASHBOARD_LITE_SCOPE_GRANT_SET.has(scope)
    ) {
      normalized.add(scope);
    }
  }

  return DASHBOARD_LITE_SCOPE_GRANTS_ORDER.filter(
    (scope) => normalized.has(scope),
  );
}
