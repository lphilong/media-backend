import { Router } from "express";
import { InfraModule } from "@infra/infra.module";
import { createEventAssignmentInfra } from "@infra/providers/event-assignment.infra";
import { createEmploymentProfileInfra } from "@infra/providers/employment-profile.infra";
import { createKpiInfra } from "@infra/providers/kpi.infra";
import { createTalentInfra } from "@infra/providers/talent.infra";
import { createUserInfra } from "@infra/providers/user.infra";
import { createWorkScheduleInfra } from "@infra/providers/work-schedule.infra";
import { SelfServiceCurrentPersonController } from "@modules/self-service/self-service.current-person.controller";
import { SelfServiceCurrentPersonService } from "@modules/self-service/self-service.current-person.service";
import { SelfServiceEventsController } from "@modules/self-service/self-service.events.controller";
import { SelfServiceEventsService } from "@modules/self-service/self-service.events.service";
import { SelfServiceKpiController } from "@modules/self-service/self-service.kpi.controller";
import { SelfServiceKpiService } from "@modules/self-service/self-service.kpi.service";
import { selfServiceRoutes } from "@modules/self-service/self-service.routes";
import { SelfServiceWorkShiftsController } from "@modules/self-service/self-service.work-shifts.controller";
import { SelfServiceWorkShiftsService } from "@modules/self-service/self-service.work-shifts.service";

export async function createSelfServiceRoutes(
  infra: InfraModule,
): Promise<Router> {
  const { employmentProfileRepository } = createEmploymentProfileInfra(
    infra.primaryDb,
  );
  const { userReadRepository } = createUserInfra(infra.primaryDb);
  const { talentRepository } = createTalentInfra(infra.primaryDb);
  const { workShiftReadRepository } = createWorkScheduleInfra(
    infra.primaryDb,
  );
  const { eventAssignmentReadRepository } = createEventAssignmentInfra(
    infra.primaryDb,
  );
  const { kpiPlanRepository, kpiActualRepository } = createKpiInfra(
    infra.primaryDb,
  );

  const currentPersonController = new SelfServiceCurrentPersonController(
    new SelfServiceCurrentPersonService(
      employmentProfileRepository,
      userReadRepository,
      talentRepository,
    ),
  );

  const workShiftsController = new SelfServiceWorkShiftsController(
    new SelfServiceWorkShiftsService(
      employmentProfileRepository,
      workShiftReadRepository,
    ),
  );

  const eventsController = new SelfServiceEventsController(
    new SelfServiceEventsService(
      employmentProfileRepository,
      talentRepository,
      eventAssignmentReadRepository,
    ),
  );

  const kpiController = new SelfServiceKpiController(
    new SelfServiceKpiService(
      employmentProfileRepository,
      talentRepository,
      kpiPlanRepository,
      kpiActualRepository,
    ),
  );

  return selfServiceRoutes(
    currentPersonController,
    workShiftsController,
    eventsController,
    kpiController,
  );
}
