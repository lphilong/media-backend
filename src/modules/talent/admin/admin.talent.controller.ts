import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import {
  TALENT_ADMIN_MUTATION_PRESENTER_KEY,
} from "@modules/talent/shared/talent.presenter-keys";
import {
  ArchiveTalentCommand,
  AssignTalentManagerCommand,
  CreateTalentCommand,
  DeactivateTalentCommand,
  LinkTalentEmploymentProfileCommand,
  ReactivateTalentCommand,
  SuspendTalentCommand,
  UpdateTalentCommercialParticipationStatusCommand,
  UpdateTalentCoreCommand,
} from "@modules/talent/shared/talent.contracts";
import { TalentValidationError } from "@modules/talent/domain/talent.errors";
import { TalentAdminService } from "./admin.talent.service";

type TalentMutationCommand =
  | "TALENT_CREATE"
  | "TALENT_UPDATE_CORE"
  | "TALENT_ASSIGN_MANAGER"
  | "TALENT_LINK_EMPLOYMENT_PROFILE"
  | "TALENT_SUSPEND"
  | "TALENT_REACTIVATE"
  | "TALENT_DEACTIVATE"
  | "TALENT_ARCHIVE"
  | "TALENT_UPDATE_COMMERCIAL_PARTICIPATION";

const CREATE_TALENT_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "talentCode",
    "stageName",
    "legalName",
    "talentOrigin",
    "managerEmploymentProfileId",
    "linkedEmploymentProfileId",
    "commercialParticipationStatus",
    "livestreamEligible",
    "eventEligible",
    "displayShortName",
    "externalRef",
    "profileSummary",
  ]);

const UPDATE_TALENT_CORE_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "stageName",
    "legalName",
    "displayShortName",
    "externalRef",
    "profileSummary",
  ]);

const ASSIGN_TALENT_MANAGER_BODY_FIELDS: readonly string[] =
  Object.freeze(["newManagerEmploymentProfileId"]);

const LINK_TALENT_EMPLOYMENT_PROFILE_BODY_FIELDS: readonly string[] =
  Object.freeze(["linkedEmploymentProfileId"]);

const UPDATE_TALENT_COMMERCIAL_PARTICIPATION_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "newCommercialParticipationStatus",
    "livestreamEligible",
    "eventEligible",
  ]);

export class TalentAdminController extends SecureController {
  constructor(
    private readonly service: TalentAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<TalentMutationCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Talent mutation command missing",
      );
    }

    switch (command) {
      case "TALENT_CREATE":
        return this.service.createTalent(
          actor,
          parseCreateTalentCommand(req),
        );

      case "TALENT_UPDATE_CORE":
        return this.service.updateTalentCore(
          actor,
          parseUpdateTalentCoreCommand(req),
        );

      case "TALENT_ASSIGN_MANAGER":
        return this.service.assignTalentManager(
          actor,
          parseAssignTalentManagerCommand(req),
        );

      case "TALENT_LINK_EMPLOYMENT_PROFILE":
        return this.service.linkTalentEmploymentProfile(
          actor,
          parseLinkTalentEmploymentProfileCommand(
            req,
          ),
        );

      case "TALENT_SUSPEND":
        return this.service.suspendTalent(
          actor,
          parseSuspendTalentCommand(req),
        );

      case "TALENT_REACTIVATE":
        return this.service.reactivateTalent(
          actor,
          parseReactivateTalentCommand(req),
        );

      case "TALENT_DEACTIVATE":
        return this.service.deactivateTalent(
          actor,
          parseDeactivateTalentCommand(req),
        );

      case "TALENT_ARCHIVE":
        return this.service.archiveTalent(
          actor,
          parseArchiveTalentCommand(req),
        );

      case "TALENT_UPDATE_COMMERCIAL_PARTICIPATION":
        return this.service.updateTalentCommercialParticipationStatus(
          actor,
          parseUpdateTalentCommercialParticipationStatusCommand(
            req,
          ),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported talent mutation command: ${command}`,
        );
    }
  }

  protected async present(
    result: unknown,
    req: Request,
    _actor: Actor,
    context: ContextType,
  ): Promise<PresentationResult> {
    return getPresenterRegistryFromRequest(req)
      .get<unknown, PresentationResult>(
        TALENT_ADMIN_MUTATION_PRESENTER_KEY,
      )
      .present(result, context);
  }
}

function parseCreateTalentCommand(
  req: Request,
): CreateTalentCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CREATE_TALENT_BODY_FIELDS,
    "createTalent",
  );

  return {
    talentCode: body.talentCode as string,
    stageName: body.stageName as string,
    legalName: body.legalName as string,
    talentOrigin:
      body.talentOrigin as CreateTalentCommand["talentOrigin"],
    managerEmploymentProfileId:
      body.managerEmploymentProfileId as
        | string
        | null
        | undefined,
    linkedEmploymentProfileId:
      body.linkedEmploymentProfileId as
        | string
        | null
        | undefined,
    commercialParticipationStatus:
      body.commercialParticipationStatus as CreateTalentCommand["commercialParticipationStatus"],
    livestreamEligible:
      body.livestreamEligible as boolean,
    eventEligible:
      body.eventEligible as boolean,
    displayShortName:
      body.displayShortName as
        | string
        | null
        | undefined,
    externalRef:
      body.externalRef as
        | string
        | null
        | undefined,
    profileSummary:
      body.profileSummary as
        | string
        | null
        | undefined,
  };
}

function parseUpdateTalentCoreCommand(
  req: Request,
): UpdateTalentCoreCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_TALENT_CORE_BODY_FIELDS,
    "updateTalentCore",
  );

  return {
    talentId: req.params.talentId,
    stageName: body.stageName as string | undefined,
    legalName: body.legalName as string | undefined,
    displayShortName:
      body.displayShortName as
        | string
        | null
        | undefined,
    externalRef:
      body.externalRef as
        | string
        | null
        | undefined,
    profileSummary:
      body.profileSummary as
        | string
        | null
        | undefined,
  };
}

function parseAssignTalentManagerCommand(
  req: Request,
): AssignTalentManagerCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    ASSIGN_TALENT_MANAGER_BODY_FIELDS,
    "assignTalentManager",
  );

  return {
    talentId: req.params.talentId,
    newManagerEmploymentProfileId:
      body.newManagerEmploymentProfileId as
        | string
        | null,
  };
}

function parseLinkTalentEmploymentProfileCommand(
  req: Request,
): LinkTalentEmploymentProfileCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    LINK_TALENT_EMPLOYMENT_PROFILE_BODY_FIELDS,
    "linkTalentEmploymentProfile",
  );

  return {
    talentId: req.params.talentId,
    linkedEmploymentProfileId:
      body.linkedEmploymentProfileId as string,
  };
}

function parseSuspendTalentCommand(
  req: Request,
): SuspendTalentCommand {
  assertNoUnexpectedFields(
    requirePlainObjectBodyForZeroBodyMutation(
      req.body,
      "TALENT_SUSPEND",
    ),
    [],
    "suspendTalent",
  );

  return {
    talentId: req.params.talentId,
  };
}

function parseReactivateTalentCommand(
  req: Request,
): ReactivateTalentCommand {
  assertNoUnexpectedFields(
    requirePlainObjectBodyForZeroBodyMutation(
      req.body,
      "TALENT_REACTIVATE",
    ),
    [],
    "reactivateTalent",
  );

  return {
    talentId: req.params.talentId,
  };
}

function parseDeactivateTalentCommand(
  req: Request,
): DeactivateTalentCommand {
  assertNoUnexpectedFields(
    requirePlainObjectBodyForZeroBodyMutation(
      req.body,
      "TALENT_DEACTIVATE",
    ),
    [],
    "deactivateTalent",
  );

  return {
    talentId: req.params.talentId,
  };
}

function parseArchiveTalentCommand(
  req: Request,
): ArchiveTalentCommand {
  assertNoUnexpectedFields(
    requirePlainObjectBodyForZeroBodyMutation(
      req.body,
      "TALENT_ARCHIVE",
    ),
    [],
    "archiveTalent",
  );

  return {
    talentId: req.params.talentId,
  };
}

function parseUpdateTalentCommercialParticipationStatusCommand(
  req: Request,
): UpdateTalentCommercialParticipationStatusCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_TALENT_COMMERCIAL_PARTICIPATION_BODY_FIELDS,
    "updateTalentCommercialParticipationStatus",
  );

  return {
    talentId: req.params.talentId,
    newCommercialParticipationStatus:
      body.newCommercialParticipationStatus as UpdateTalentCommercialParticipationStatusCommand["newCommercialParticipationStatus"],
    livestreamEligible:
      body.livestreamEligible as boolean,
    eventEligible:
      body.eventEligible as boolean,
  };
}

function requireRecord(
  value: unknown,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return {};
  }

  return value as Record<string, unknown>;
}

function requirePlainObjectBodyForZeroBodyMutation(
  value: unknown,
  mutation: TalentMutationCommand,
): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TalentValidationError(
      `Request body for ${mutation} must be a plain object`,
    );
  }

  return value as Record<string, unknown>;
}

function assertNoUnexpectedFields(
  body: Record<string, unknown>,
  allowedFields: readonly string[],
  mutationName: string,
): void {
  const unexpectedFields = Object.keys(body).filter(
    (field) => !allowedFields.includes(field),
  );

  if (unexpectedFields.length === 0) {
    return;
  }

  throw new TalentValidationError(
    `${mutationName} payload contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
