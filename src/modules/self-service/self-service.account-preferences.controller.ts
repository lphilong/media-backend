import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { SelfServiceValidationError } from "./domain/self-service.errors";
import {
  SelfServiceAccountPreferencesUpdateInput,
  SelfServiceCurrentPersonView,
} from "./domain/self-service.types";
import { SelfServiceCurrentPersonExposure } from "./shared/self-service.exposure";
import { SelfServiceAccountPreferencesService } from "./self-service.account-preferences.service";

type SelfServiceAccountPreferencesCommand =
  "SELF_SERVICE_ACCOUNT_PREFERENCES_UPDATE";

const ALLOWED_ACCOUNT_PREFERENCES_FIELDS = new Set(["locale", "timezone"]);

export class SelfServiceAccountPreferencesController extends SecureController {
  constructor(private readonly service: SelfServiceAccountPreferencesService) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<SelfServiceCurrentPersonView> {
    const command = readCommand<SelfServiceAccountPreferencesCommand>(req);

    if (command !== "SELF_SERVICE_ACCOUNT_PREFERENCES_UPDATE") {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Self-service account preferences command missing",
      );
    }

    return this.service.updatePreferences(
      actor,
      parseAccountPreferencesBody(req.body),
    );
  }

  protected async present(
    result: SelfServiceCurrentPersonView,
  ): Promise<PresentationResult> {
    return {
      data: SelfServiceCurrentPersonExposure.expose(result),
    };
  }
}

function parseAccountPreferencesBody(
  value: unknown,
): SelfServiceAccountPreferencesUpdateInput {
  if (!isPlainObject(value)) {
    throw new SelfServiceValidationError(
      "Self-service account preferences payload must be an object",
    );
  }

  const fields = Object.keys(value);
  const unsupported = fields.filter(
    (field) => !ALLOWED_ACCOUNT_PREFERENCES_FIELDS.has(field),
  );

  if (unsupported.length > 0) {
    throw new SelfServiceValidationError(
      "Self-service account preferences payload contains unsupported fields",
    );
  }

  const output: {
    locale?: string;
    timezone?: string;
  } = {};

  if ("locale" in value) {
    output.locale = readStringField(value.locale, "locale");
  }

  if ("timezone" in value) {
    output.timezone = readStringField(value.timezone, "timezone");
  }

  return output;
}

function readStringField(
  value: unknown,
  fieldName: "locale" | "timezone",
): string {
  if (typeof value !== "string") {
    throw new SelfServiceValidationError(
      `Self-service account preferences ${fieldName} must be a string`,
    );
  }

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
