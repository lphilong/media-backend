import { Actor } from "@core/actor/actor";
import { SelfServiceCurrentPersonView } from "@modules/self-service/domain/self-service.types";
import { SelfServiceIdentityResolver } from "@modules/self-service/shared/self-service.identity-resolver";
import { deriveTalentDisplaySummary } from "@modules/talent/domain/talent-display";
import { UserReadRepository } from "@modules/user/read/user.read-repository";

export class SelfServiceCurrentPersonService {
  constructor(
    private readonly identityResolver: SelfServiceIdentityResolver,
    private readonly userReadRepository: UserReadRepository,
  ) {}

  async getCurrentPerson(
    actor: Actor,
  ): Promise<SelfServiceCurrentPersonView> {
    const { employmentProfile, linkedInternalTalent } =
      await this.identityResolver.resolveEmploymentProfileWithLinkedInternalTalent(
        actor,
      );

    const user = await this.userReadRepository.getUserDetail(actor.id);

    return {
      employmentProfileId: employmentProfile.id,
      employeeCode: employmentProfile.employeeCode,
      displayName: employmentProfile.displayName,
      employmentStatus: employmentProfile.employmentStatus,
      accountEmail: user?.profile.email,
      accountStatus: user?.accountStatus,
      accountLinkStatus: "LINKED",
      linkedInternalTalent: linkedInternalTalent
        ? {
            talentId: linkedInternalTalent.id,
            talentCode: linkedInternalTalent.talentCode,
            ...deriveTalentDisplaySummary(linkedInternalTalent, {
              displayName: employmentProfile.displayName,
            }),
          }
        : undefined,
      locale: user?.preferences.locale,
      timezone: user?.preferences.timezone,
    };
  }
}
