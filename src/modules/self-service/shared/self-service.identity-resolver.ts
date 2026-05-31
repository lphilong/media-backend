import { Actor } from "@core/actor/actor";
import {
  EmploymentProfileRecord,
} from "@modules/employment-profile/domain/employment-profile.types";
import { EmploymentProfileRepository } from "@modules/employment-profile/domain/employment-profile.repository";
import { SelfServiceCurrentPersonNotLinkedError } from "@modules/self-service/domain/self-service.errors";
import { TalentRepository } from "@modules/talent/domain/talent.repository";
import { TalentRecord } from "@modules/talent/domain/talent.types";

export interface SelfServiceResolvedEmploymentProfile {
  readonly employmentProfile: EmploymentProfileRecord;
}

export interface SelfServiceResolvedEmploymentProfileWithTalent
  extends SelfServiceResolvedEmploymentProfile {
  readonly linkedInternalTalent?: TalentRecord;
}

export class SelfServiceIdentityResolver {
  constructor(
    private readonly employmentProfileRepository: EmploymentProfileRepository,
    private readonly talentRepository: TalentRepository,
  ) {}

  async resolveEmploymentProfile(
    actor: Actor,
  ): Promise<SelfServiceResolvedEmploymentProfile> {
    const employmentProfile =
      await this.employmentProfileRepository.findNonArchivedByLinkedUserId(
        actor.id,
      );

    if (!employmentProfile) {
      throw new SelfServiceCurrentPersonNotLinkedError();
    }

    return { employmentProfile };
  }

  async resolveEmploymentProfileWithLinkedInternalTalent(
    actor: Actor,
  ): Promise<SelfServiceResolvedEmploymentProfileWithTalent> {
    const { employmentProfile } = await this.resolveEmploymentProfile(actor);
    const linkedTalent =
      await this.talentRepository.findNonArchivedByLinkedEmploymentProfileId(
        employmentProfile.id,
      );

    if (
      linkedTalent?.talentOrigin !== "INTERNAL" ||
      linkedTalent.linkedEmploymentProfileId !== employmentProfile.id
    ) {
      return { employmentProfile };
    }

    return {
      employmentProfile,
      linkedInternalTalent: linkedTalent,
    };
  }
}
