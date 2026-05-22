import { Db } from "mongodb";
import { PresenterRegistryWriter } from "@app/presenter/presenter.runtime-access";
import { initDomainEventOutbox } from "@system/outbox/outbox.schema";
import { initBusinessCodeSequenceIndexes } from "@infra/mongo/business-code/business-code-sequence.index";
import { createRoleBootstrapRegistrar } from "@modules/role/shared/role.bootstrap";
import { SystemInvariantError } from "@core/error/system-error";
import { createUserBootstrapRegistrar } from "@modules/user/shared/user.bootstrap";
import { createOrgUnitBootstrapRegistrar } from "@modules/org-unit/shared/org-unit.bootstrap";
import { createEmploymentProfileBootstrapRegistrar } from "@modules/employment-profile/shared/employment-profile.bootstrap";
import { createTalentBootstrapRegistrar } from "@modules/talent/shared/talent.bootstrap";
import { createTalentGroupBootstrapRegistrar } from "@modules/talent-group/shared/talent-group.bootstrap";
import { createPlatformAccountBootstrapRegistrar } from "@modules/platform-account/shared/platform-account.bootstrap";
import { createStudioResourceBootstrapRegistrar } from "@modules/studio-resource/shared/studio-resource.bootstrap";
import { createWorkScheduleBootstrapRegistrar } from "@modules/work-schedule/shared/work-schedule.bootstrap";
import { createEventAssignmentBootstrapRegistrar } from "@modules/event-assignment/shared/event-assignment.bootstrap";
import { createContractRegistryBootstrapRegistrar } from "@modules/contract-registry/shared/contract-registry.bootstrap";
import { createTalentKpiBootstrapRegistrar } from "@modules/talent-kpi/shared/talent-kpi.bootstrap";
import { createKpiBootstrapRegistrar } from "@modules/kpi/shared/kpi.bootstrap";
import { createCommissionBootstrapRegistrar } from "@modules/commission/shared/commission.bootstrap";
import { createRevenueLedgerBootstrapRegistrar } from "@modules/revenue-ledger/shared/revenue-ledger.bootstrap";
import { createDashboardLiteBootstrapRegistrar } from "@modules/dashboard-lite/shared/dashboard-lite.bootstrap";

export interface BootstrapRegistrar {
  readonly name: string;
  registerPresenters?(
    registry: PresenterRegistryWriter,
  ): void;
  initIndexes?(db: Db): Promise<void>;
  assertReadiness?(db: Db): Promise<void>;
}

const FOUNDATION_BOOTSTRAP_REGISTRAR: BootstrapRegistrar =
  Object.freeze({
    name: "foundation",
    async initIndexes(db: Db): Promise<void> {
      await initDomainEventOutbox(db);
      await initBusinessCodeSequenceIndexes(db);
    },
  });

const BOOTSTRAP_REGISTRARS: readonly BootstrapRegistrar[] =
  Object.freeze([
    FOUNDATION_BOOTSTRAP_REGISTRAR,
    createRoleBootstrapRegistrar(),
    createUserBootstrapRegistrar(),
    createOrgUnitBootstrapRegistrar(),
    createEmploymentProfileBootstrapRegistrar(),
    createTalentBootstrapRegistrar(),
    createTalentGroupBootstrapRegistrar(),
    createPlatformAccountBootstrapRegistrar(),
    createStudioResourceBootstrapRegistrar(),
    createWorkScheduleBootstrapRegistrar(),
    createEventAssignmentBootstrapRegistrar(),
    createContractRegistryBootstrapRegistrar(),
    createTalentKpiBootstrapRegistrar(),
    createKpiBootstrapRegistrar(),
    createCommissionBootstrapRegistrar(),
    createRevenueLedgerBootstrapRegistrar(),
    createDashboardLiteBootstrapRegistrar(),
  ]);

assertUniqueRegistrarNames(BOOTSTRAP_REGISTRARS);

export function getBootstrapRegistrars(): readonly BootstrapRegistrar[] {
  return BOOTSTRAP_REGISTRARS;
}

export function registerBootstrapPresenters(
  registry: PresenterRegistryWriter,
): void {
  for (const registrar of BOOTSTRAP_REGISTRARS) {
    registrar.registerPresenters?.(registry);
  }
}

export async function bootstrapRegisteredIndexes(
  db: Db,
): Promise<void> {
  for (const registrar of BOOTSTRAP_REGISTRARS) {
    if (registrar.initIndexes) {
      await registrar.initIndexes(db);
    }
  }

  for (const registrar of BOOTSTRAP_REGISTRARS) {
    if (registrar.assertReadiness) {
      await registrar.assertReadiness(db);
    }
  }
}

function assertUniqueRegistrarNames(
  registrars: readonly BootstrapRegistrar[],
): void {
  const names = new Set<string>();

  for (const registrar of registrars) {
    if (!registrar.name.trim()) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Bootstrap registrar name must not be empty",
      );
    }

    if (names.has(registrar.name)) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        `Duplicate bootstrap registrar detected: ${registrar.name}`,
      );
    }

    names.add(registrar.name);
  }
}
