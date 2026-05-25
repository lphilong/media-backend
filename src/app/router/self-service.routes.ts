import { Router } from "express";
import { InfraModule } from "@infra/infra.module";
import { createEmploymentProfileInfra } from "@infra/providers/employment-profile.infra";
import { createTalentInfra } from "@infra/providers/talent.infra";
import { createUserInfra } from "@infra/providers/user.infra";
import { SelfServiceCurrentPersonController } from "@modules/self-service/self-service.current-person.controller";
import { SelfServiceCurrentPersonService } from "@modules/self-service/self-service.current-person.service";
import { selfServiceRoutes } from "@modules/self-service/self-service.routes";

export async function createSelfServiceRoutes(
  infra: InfraModule,
): Promise<Router> {
  const { employmentProfileRepository } = createEmploymentProfileInfra(
    infra.primaryDb,
  );
  const { userReadRepository } = createUserInfra(infra.primaryDb);
  const { talentRepository } = createTalentInfra(infra.primaryDb);

  const currentPersonController = new SelfServiceCurrentPersonController(
    new SelfServiceCurrentPersonService(
      employmentProfileRepository,
      userReadRepository,
      talentRepository,
    ),
  );

  return selfServiceRoutes(currentPersonController);
}
