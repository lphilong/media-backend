import { Router } from "express";
import { InfraModule } from "@infra/infra.module";
import { createEventAssignmentInfra } from "@infra/providers/event-assignment.infra";
import { createEmploymentProfileInfra } from "@infra/providers/employment-profile.infra";
import { createKpiInfra } from "@infra/providers/kpi.infra";
import { createTalentGroupInfra } from "@infra/providers/talent-group.infra";
import { createTalentInfra } from "@infra/providers/talent.infra";
import { createUserInfra } from "@infra/providers/user.infra";
import { createWorkScheduleInfra } from "@infra/providers/work-schedule.infra";
import { SelfServiceAccountPreferencesController } from "@modules/self-service/self-service.account-preferences.controller";
import { SelfServiceAccountPreferencesService } from "@modules/self-service/self-service.account-preferences.service";
import { SelfServiceCurrentPersonController } from "@modules/self-service/self-service.current-person.controller";
import { SelfServiceCurrentPersonService } from "@modules/self-service/self-service.current-person.service";
import { SelfServiceEventsController } from "@modules/self-service/self-service.events.controller";
import { SelfServiceEventsService } from "@modules/self-service/self-service.events.service";
import { SelfServiceKpiController } from "@modules/self-service/self-service.kpi.controller";
import { SelfServiceKpiService } from "@modules/self-service/self-service.kpi.service";
import { selfServiceRoutes } from "@modules/self-service/self-service.routes";
import { SelfServiceTalentGroupsController } from "@modules/self-service/self-service.talent-groups.controller";
import { SelfServiceTalentGroupsService } from "@modules/self-service/self-service.talent-groups.service";
import { SelfServiceWorkShiftsController } from "@modules/self-service/self-service.work-shifts.controller";
import { SelfServiceWorkShiftsService } from "@modules/self-service/self-service.work-shifts.service";
import { SelfServiceIdentityResolver } from "@modules/self-service/shared/self-service.identity-resolver";

export async function createSelfServiceRoutes(
  infra: InfraModule,
): Promise<Router> {
  const { employmentProfileRepository } = createEmploymentProfileInfra(
    infra.primaryDb,
  );
  const { userRepository, userReadRepository } = createUserInfra(
    infra.primaryDb,
  );
  const { talentRepository } = createTalentInfra(infra.primaryDb);
  const { selfServiceTalentGroupsReadRepository } = createTalentGroupInfra(
    infra.primaryDb,
  );
  const { workShiftReadRepository } = createWorkScheduleInfra(infra.primaryDb);
  const { eventAssignmentReadRepository } = createEventAssignmentInfra(
    infra.primaryDb,
  );
  const { kpiPlanRepository, kpiActualRepository } = createKpiInfra(
    infra.primaryDb,
  );

  const identityResolver = new SelfServiceIdentityResolver(
    employmentProfileRepository,
    talentRepository,
  );
  const currentPersonService = new SelfServiceCurrentPersonService(
    identityResolver,
    userReadRepository,
  );
  const currentPersonController = new SelfServiceCurrentPersonController(
    currentPersonService,
  );

  const workShiftsController = new SelfServiceWorkShiftsController(
    new SelfServiceWorkShiftsService(
      identityResolver,
      workShiftReadRepository,
    ),
  );

  const eventsController = new SelfServiceEventsController(
    new SelfServiceEventsService(
      identityResolver,
      eventAssignmentReadRepository,
    ),
  );

  const accountPreferencesController =
    new SelfServiceAccountPreferencesController(
      new SelfServiceAccountPreferencesService(
        identityResolver,
        userRepository,
        currentPersonService,
      ),
    );

  const kpiController = new SelfServiceKpiController(
    new SelfServiceKpiService(
      identityResolver,
      kpiPlanRepository,
      kpiActualRepository,
    ),
  );

  const talentGroupsController = new SelfServiceTalentGroupsController(
    new SelfServiceTalentGroupsService(
      identityResolver,
      selfServiceTalentGroupsReadRepository,
    ),
  );

  return selfServiceRoutes(
    currentPersonController,
    workShiftsController,
    eventsController,
    accountPreferencesController,
    kpiController,
    talentGroupsController,
  );
}
