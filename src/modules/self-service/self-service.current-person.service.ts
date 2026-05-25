import { Actor } from "@core/actor/actor";
import { EmploymentProfileRepository } from "@modules/employment-profile/domain/employment-profile.repository";
import { SelfServiceCurrentPersonNotLinkedError } from "@modules/self-service/domain/self-service.errors";
import { SelfServiceCurrentPersonView } from "@modules/self-service/domain/self-service.types";
import { TalentRepository } from "@modules/talent/domain/talent.repository";
import { deriveTalentDisplaySummary } from "@modules/talent/domain/talent-display";
import { UserReadRepository } from "@modules/user/read/user.read-repository";

export class SelfServiceCurrentPersonService {
  constructor(
    private readonly employmentProfileRepository: EmploymentProfileRepository,
    private readonly userReadRepository: UserReadRepository,
    private readonly talentRepository: TalentRepository,
  ) {}

  async getCurrentPerson(
    actor: Actor,
  ): Promise<SelfServiceCurrentPersonView> {
    const employmentProfile =
      await this.employmentProfileRepository.findNonArchivedByLinkedUserId(
        actor.id,
      );

    if (!employmentProfile) {
      throw new SelfServiceCurrentPersonNotLinkedError();
    }

    const [user, linkedTalent] = await Promise.all([
      this.userReadRepository.getUserDetail(actor.id),
      this.talentRepository.findNonArchivedByLinkedEmploymentProfileId(
        employmentProfile.id,
      ),
    ]);

    return {
      employmentProfileId: employmentProfile.id,
      employeeCode: employmentProfile.employeeCode,
      displayName: employmentProfile.displayName,
      employmentStatus: employmentProfile.employmentStatus,
      accountEmail: user?.profile.email,
      accountStatus: user?.accountStatus,
      accountLinkStatus: "LINKED",
      linkedInternalTalent:
        linkedTalent?.talentOrigin === "INTERNAL"
          ? {
              talentId: linkedTalent.id,
              talentCode: linkedTalent.talentCode,
              ...deriveTalentDisplaySummary(linkedTalent, {
                displayName: employmentProfile.displayName,
              }),
            }
          : undefined,
      locale: user?.preferences.locale,
      timezone: user?.preferences.timezone,
    };
  }
}
