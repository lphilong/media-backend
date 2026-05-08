import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { TalentGroupValidationError } from "@modules/talent-group/domain/talent-group.errors";
import { TALENT_GROUP_ADMIN_MUTATION_PRESENTER_KEY } from "@modules/talent-group/shared/talent-group.presenter-keys";
import {
  ActivateTalentGroupCommand,
  AddTalentGroupMemberCommand,
  ArchiveTalentGroupCommand,
  CreateTalentGroupCommand,
  DeactivateTalentGroupCommand,
  DeactivateTalentGroupMemberCommand,
  ReactivateTalentGroupMemberCommand,
  RemoveTalentGroupMemberCommand,
  UpdateTalentGroupCoreCommand,
  UpdateTalentGroupMemberLineupCommand,
} from "@modules/talent-group/shared/talent-group.contracts";
import { TalentGroupAdminService } from "./admin.talent-group.service";

type TalentGroupMutationCommand =
  | "TALENT_GROUP_CREATE"
  | "TALENT_GROUP_UPDATE_CORE"
  | "TALENT_GROUP_ACTIVATE"
  | "TALENT_GROUP_DEACTIVATE"
  | "TALENT_GROUP_ARCHIVE"
  | "TALENT_GROUP_ADD_MEMBER"
  | "TALENT_GROUP_UPDATE_MEMBER_LINEUP"
  | "TALENT_GROUP_DEACTIVATE_MEMBER"
  | "TALENT_GROUP_REACTIVATE_MEMBER"
  | "TALENT_GROUP_REMOVE_MEMBER";

const CREATE_TALENT_GROUP_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "groupCode",
    "name",
    "shortName",
    "description",
    "displayOrder",
    "externalRef",
  ]);

const UPDATE_TALENT_GROUP_CORE_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "name",
    "shortName",
    "description",
    "displayOrder",
    "externalRef",
  ]);

const ADD_TALENT_GROUP_MEMBER_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "talentId",
    "lineupOrder",
  ]);

const UPDATE_TALENT_GROUP_MEMBER_LINEUP_BODY_FIELDS: readonly string[] =
  Object.freeze(["newLineupOrder"]);

export class TalentGroupAdminController extends SecureController {
  constructor(
    private readonly service: TalentGroupAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<TalentGroupMutationCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Talent group mutation command missing",
      );
    }

    switch (command) {
      case "TALENT_GROUP_CREATE":
        return this.service.createTalentGroup(
          actor,
          parseCreateTalentGroupCommand(req),
        );

      case "TALENT_GROUP_UPDATE_CORE":
        return this.service.updateTalentGroupCore(
          actor,
          parseUpdateTalentGroupCoreCommand(req),
        );

      case "TALENT_GROUP_ACTIVATE":
        return this.service.activateTalentGroup(
          actor,
          parseActivateTalentGroupCommand(req),
        );

      case "TALENT_GROUP_DEACTIVATE":
        return this.service.deactivateTalentGroup(
          actor,
          parseDeactivateTalentGroupCommand(req),
        );

      case "TALENT_GROUP_ARCHIVE":
        return this.service.archiveTalentGroup(
          actor,
          parseArchiveTalentGroupCommand(req),
        );

      case "TALENT_GROUP_ADD_MEMBER":
        return this.service.addTalentGroupMember(
          actor,
          parseAddTalentGroupMemberCommand(req),
        );

      case "TALENT_GROUP_UPDATE_MEMBER_LINEUP":
        return this.service.updateTalentGroupMemberLineup(
          actor,
          parseUpdateTalentGroupMemberLineupCommand(req),
        );

      case "TALENT_GROUP_DEACTIVATE_MEMBER":
        return this.service.deactivateTalentGroupMember(
          actor,
          parseDeactivateTalentGroupMemberCommand(
            req,
          ),
        );

      case "TALENT_GROUP_REACTIVATE_MEMBER":
        return this.service.reactivateTalentGroupMember(
          actor,
          parseReactivateTalentGroupMemberCommand(
            req,
          ),
        );

      case "TALENT_GROUP_REMOVE_MEMBER":
        return this.service.removeTalentGroupMember(
          actor,
          parseRemoveTalentGroupMemberCommand(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported talent group mutation command: ${command}`,
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
        TALENT_GROUP_ADMIN_MUTATION_PRESENTER_KEY,
      )
      .present(result, context);
  }
}

function parseCreateTalentGroupCommand(
  req: Request,
): CreateTalentGroupCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CREATE_TALENT_GROUP_BODY_FIELDS,
    "createTalentGroup",
  );

  return {
    groupCode: body.groupCode as string,
    name: body.name as string,
    shortName:
      body.shortName as string | null | undefined,
    description:
      body.description as
        | string
        | null
        | undefined,
    displayOrder:
      body.displayOrder as number | string,
    externalRef:
      body.externalRef as
        | string
        | null
        | undefined,
  };
}

function parseUpdateTalentGroupCoreCommand(
  req: Request,
): UpdateTalentGroupCoreCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_TALENT_GROUP_CORE_BODY_FIELDS,
    "updateTalentGroupCore",
  );

  return {
    groupId: req.params.groupId,
    name: body.name as string | undefined,
    shortName:
      body.shortName as string | null | undefined,
    description:
      body.description as
        | string
        | null
        | undefined,
    displayOrder:
      body.displayOrder as
        | number
        | string
        | undefined,
    externalRef:
      body.externalRef as
        | string
        | null
        | undefined,
  };
}

function parseActivateTalentGroupCommand(
  req: Request,
): ActivateTalentGroupCommand {
  assertNoUnexpectedFields(
    requirePlainObjectBodyForZeroBodyMutation(
      req.body,
      "TALENT_GROUP_ACTIVATE",
    ),
    [],
    "activateTalentGroup",
  );

  return {
    groupId: req.params.groupId,
  };
}

function parseDeactivateTalentGroupCommand(
  req: Request,
): DeactivateTalentGroupCommand {
  assertNoUnexpectedFields(
    requirePlainObjectBodyForZeroBodyMutation(
      req.body,
      "TALENT_GROUP_DEACTIVATE",
    ),
    [],
    "deactivateTalentGroup",
  );

  return {
    groupId: req.params.groupId,
  };
}

function parseArchiveTalentGroupCommand(
  req: Request,
): ArchiveTalentGroupCommand {
  assertNoUnexpectedFields(
    requirePlainObjectBodyForZeroBodyMutation(
      req.body,
      "TALENT_GROUP_ARCHIVE",
    ),
    [],
    "archiveTalentGroup",
  );

  return {
    groupId: req.params.groupId,
  };
}

function parseAddTalentGroupMemberCommand(
  req: Request,
): AddTalentGroupMemberCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    ADD_TALENT_GROUP_MEMBER_BODY_FIELDS,
    "addTalentGroupMember",
  );

  return {
    groupId: req.params.groupId,
    talentId: body.talentId as string,
    lineupOrder: body.lineupOrder as number,
  };
}

function parseUpdateTalentGroupMemberLineupCommand(
  req: Request,
): UpdateTalentGroupMemberLineupCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_TALENT_GROUP_MEMBER_LINEUP_BODY_FIELDS,
    "updateTalentGroupMemberLineup",
  );

  return {
    membershipId: req.params.membershipId,
    newLineupOrder:
      body.newLineupOrder as number,
  };
}

function parseDeactivateTalentGroupMemberCommand(
  req: Request,
): DeactivateTalentGroupMemberCommand {
  assertNoUnexpectedFields(
    requirePlainObjectBodyForZeroBodyMutation(
      req.body,
      "TALENT_GROUP_DEACTIVATE_MEMBER",
    ),
    [],
    "deactivateTalentGroupMember",
  );

  return {
    membershipId: req.params.membershipId,
  };
}

function parseReactivateTalentGroupMemberCommand(
  req: Request,
): ReactivateTalentGroupMemberCommand {
  assertNoUnexpectedFields(
    requirePlainObjectBodyForZeroBodyMutation(
      req.body,
      "TALENT_GROUP_REACTIVATE_MEMBER",
    ),
    [],
    "reactivateTalentGroupMember",
  );

  return {
    membershipId: req.params.membershipId,
  };
}

function parseRemoveTalentGroupMemberCommand(
  req: Request,
): RemoveTalentGroupMemberCommand {
  assertNoUnexpectedFields(
    requirePlainObjectBodyForZeroBodyMutation(
      req.body,
      "TALENT_GROUP_REMOVE_MEMBER",
    ),
    [],
    "removeTalentGroupMember",
  );

  return {
    membershipId: req.params.membershipId,
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
  mutation: TalentGroupMutationCommand,
): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TalentGroupValidationError(
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

  throw new TalentGroupValidationError(
    `${mutationName} payload contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
