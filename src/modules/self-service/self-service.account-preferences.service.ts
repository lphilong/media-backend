import { Actor } from "@core/actor/actor";
import { EmploymentProfileRepository } from "@modules/employment-profile/domain/employment-profile.repository";
import { UserMutationRepository } from "@modules/user/domain/user.repository";
import {
  SelfServiceAccountPreferencesUpdateInput,
  SelfServiceCurrentPersonView,
} from "./domain/self-service.types";
import {
  SelfServiceCurrentPersonNotLinkedError,
  SelfServiceValidationError,
} from "./domain/self-service.errors";
import { SelfServiceCurrentPersonService } from "./self-service.current-person.service";

const SUPPORTED_SELF_SERVICE_LOCALES = new Set(["en", "vi", "zh"]);

export class SelfServiceAccountPreferencesService {
  constructor(
    private readonly employmentProfiles: EmploymentProfileRepository,
    private readonly users: UserMutationRepository,
    private readonly currentPersonService: SelfServiceCurrentPersonService,
    private readonly now: () => number = Date.now,
  ) {}

  async updatePreferences(
    actor: Actor,
    input: SelfServiceAccountPreferencesUpdateInput,
  ): Promise<SelfServiceCurrentPersonView> {
    const locale = normalizeOptionalString(input.locale, "locale");
    const timezone = normalizeOptionalString(input.timezone, "timezone");

    if (locale === undefined && timezone === undefined) {
      throw new SelfServiceValidationError(
        "Self-service account preferences update requires locale or timezone",
      );
    }

    if (locale !== undefined && !SUPPORTED_SELF_SERVICE_LOCALES.has(locale)) {
      throw new SelfServiceValidationError("Unsupported self-service locale");
    }

    if (timezone !== undefined && !isValidIanaTimezone(timezone)) {
      throw new SelfServiceValidationError("Unsupported self-service timezone");
    }

    const employmentProfile =
      await this.employmentProfiles.findNonArchivedByLinkedUserId(actor.id);

    if (!employmentProfile) {
      throw new SelfServiceCurrentPersonNotLinkedError();
    }

    const updated = await this.users.updatePreferences({
      userId: actor.id,
      locale,
      timezone,
      updatedAt: this.now(),
    });

    if (!updated) {
      throw new SelfServiceCurrentPersonNotLinkedError();
    }

    return this.currentPersonService.getCurrentPerson(actor);
  }
}

function normalizeOptionalString(
  value: string | undefined,
  fieldName: "locale" | "timezone",
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new SelfServiceValidationError(
      `Self-service account preferences ${fieldName} cannot be empty`,
    );
  }

  return trimmed;
}

function isValidIanaTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(
      new Date(0),
    );
    return true;
  } catch {
    return false;
  }
}
