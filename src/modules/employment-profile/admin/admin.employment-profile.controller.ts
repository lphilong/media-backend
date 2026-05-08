import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import {
  EMPLOYMENT_PROFILE_ADMIN_MUTATION_PRESENTER_KEY,
} from "@modules/employment-profile/shared/employment-profile.presenter-keys";
import { EmploymentProfileValidationError } from "@modules/employment-profile/domain/employment-profile.errors";
import {
  ArchiveEmploymentProfileCommand,
  AssignEmploymentProfileManagerCommand,
  AssignEmploymentProfileOrgUnitCommand,
  CreateEmploymentProfileCommand,
  LinkEmploymentProfileUserCommand,
  PlaceEmploymentProfileOnLeaveCommand,
  ReactivateEmploymentProfileCommand,
  ReturnEmploymentProfileFromLeaveCommand,
  SuspendEmploymentProfileCommand,
  TerminateEmploymentProfileCommand,
  UnlinkEmploymentProfileUserCommand,
  UpdateEmploymentProfileContractStatusCommand,
  UpdateEmploymentProfileCoreCommand,
} from "@modules/employment-profile/shared/employment-profile.contracts";
import { EmploymentProfileAdminService } from "./admin.employment-profile.service";

type EmploymentProfileMutationCommand =
  | "EMPLOYMENT_PROFILE_CREATE"
  | "EMPLOYMENT_PROFILE_UPDATE_CORE"
  | "EMPLOYMENT_PROFILE_ASSIGN_ORG_UNIT"
  | "EMPLOYMENT_PROFILE_ASSIGN_MANAGER"
  | "EMPLOYMENT_PROFILE_LINK_USER"
  | "EMPLOYMENT_PROFILE_UNLINK_USER"
  | "EMPLOYMENT_PROFILE_PLACE_ON_LEAVE"
  | "EMPLOYMENT_PROFILE_RETURN_FROM_LEAVE"
  | "EMPLOYMENT_PROFILE_SUSPEND"
  | "EMPLOYMENT_PROFILE_REACTIVATE"
  | "EMPLOYMENT_PROFILE_TERMINATE"
  | "EMPLOYMENT_PROFILE_ARCHIVE"
  | "EMPLOYMENT_PROFILE_UPDATE_CONTRACT_STATUS";

const CREATE_EMPLOYMENT_PROFILE_ALLOWED_BODY_KEYS =
  Object.freeze([
    "employeeCode",
    "legalName",
    "displayName",
    "employmentKind",
    "jobTitle",
    "orgUnitId",
    "managerEmploymentProfileId",
    "linkedUserId",
    "contractStatus",
    "employmentStartDate",
    "externalRef",
    "titleDescription",
  ] as const);

const UPDATE_EMPLOYMENT_PROFILE_CORE_ALLOWED_BODY_KEYS =
  Object.freeze([
    "legalName",
    "displayName",
    "employmentKind",
    "jobTitle",
    "externalRef",
    "titleDescription",
  ] as const);

const ASSIGN_EMPLOYMENT_PROFILE_ORG_UNIT_ALLOWED_BODY_KEYS =
  Object.freeze(["newOrgUnitId"] as const);

const ASSIGN_EMPLOYMENT_PROFILE_MANAGER_ALLOWED_BODY_KEYS =
  Object.freeze([
    "newManagerEmploymentProfileId",
  ] as const);

const LINK_EMPLOYMENT_PROFILE_USER_ALLOWED_BODY_KEYS =
  Object.freeze(["linkedUserId"] as const);

const TERMINATE_EMPLOYMENT_PROFILE_ALLOWED_BODY_KEYS =
  Object.freeze(["employmentEndDate"] as const);

const UPDATE_EMPLOYMENT_PROFILE_CONTRACT_STATUS_ALLOWED_BODY_KEYS =
  Object.freeze(["newContractStatus"] as const);

export class EmploymentProfileAdminController extends SecureController {
  constructor(
    private readonly service: EmploymentProfileAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<EmploymentProfileMutationCommand>(
        req,
      );

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Employment profile mutation command missing",
      );
    }

    switch (command) {
      case "EMPLOYMENT_PROFILE_CREATE":
        return this.service.createEmploymentProfile(
          actor,
          parseCreateEmploymentProfileCommand(req),
        );

      case "EMPLOYMENT_PROFILE_UPDATE_CORE":
        return this.service.updateEmploymentProfileCore(
          actor,
          parseUpdateEmploymentProfileCoreCommand(req),
        );

      case "EMPLOYMENT_PROFILE_ASSIGN_ORG_UNIT":
        return this.service.assignEmploymentProfileOrgUnit(
          actor,
          parseAssignEmploymentProfileOrgUnitCommand(
            req,
          ),
        );

      case "EMPLOYMENT_PROFILE_ASSIGN_MANAGER":
        return this.service.assignEmploymentProfileManager(
          actor,
          parseAssignEmploymentProfileManagerCommand(
            req,
          ),
        );

      case "EMPLOYMENT_PROFILE_LINK_USER":
        return this.service.linkEmploymentProfileUser(
          actor,
          parseLinkEmploymentProfileUserCommand(req),
        );

      case "EMPLOYMENT_PROFILE_UNLINK_USER":
        return this.service.unlinkEmploymentProfileUser(
          actor,
          parseUnlinkEmploymentProfileUserCommand(
            req,
          ),
        );

      case "EMPLOYMENT_PROFILE_PLACE_ON_LEAVE":
        return this.service.placeEmploymentProfileOnLeave(
          actor,
          parsePlaceEmploymentProfileOnLeaveCommand(
            req,
          ),
        );

      case "EMPLOYMENT_PROFILE_RETURN_FROM_LEAVE":
        return this.service.returnEmploymentProfileFromLeave(
          actor,
          parseReturnEmploymentProfileFromLeaveCommand(
            req,
          ),
        );

      case "EMPLOYMENT_PROFILE_SUSPEND":
        return this.service.suspendEmploymentProfile(
          actor,
          parseSuspendEmploymentProfileCommand(req),
        );

      case "EMPLOYMENT_PROFILE_REACTIVATE":
        return this.service.reactivateEmploymentProfile(
          actor,
          parseReactivateEmploymentProfileCommand(req),
        );

      case "EMPLOYMENT_PROFILE_TERMINATE":
        return this.service.terminateEmploymentProfile(
          actor,
          parseTerminateEmploymentProfileCommand(req),
        );

      case "EMPLOYMENT_PROFILE_ARCHIVE":
        return this.service.archiveEmploymentProfile(
          actor,
          parseArchiveEmploymentProfileCommand(req),
        );

      case "EMPLOYMENT_PROFILE_UPDATE_CONTRACT_STATUS":
        return this.service.updateEmploymentProfileContractStatus(
          actor,
          parseUpdateEmploymentProfileContractStatusCommand(
            req,
          ),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported employment profile mutation command: ${command}`,
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
        EMPLOYMENT_PROFILE_ADMIN_MUTATION_PRESENTER_KEY,
      )
      .present(result, context);
  }
}

function parseCreateEmploymentProfileCommand(
  req: Request,
): CreateEmploymentProfileCommand {
  const body = requireRecord(req.body);
  assertAllowedBodyKeys(
    body,
    CREATE_EMPLOYMENT_PROFILE_ALLOWED_BODY_KEYS,
    "EMPLOYMENT_PROFILE_CREATE",
  );

  return {
    employeeCode: body.employeeCode as string,
    legalName: body.legalName as string,
    displayName: body.displayName as string,
    employmentKind:
      body.employmentKind as CreateEmploymentProfileCommand["employmentKind"],
    jobTitle: body.jobTitle as string,
    orgUnitId: body.orgUnitId as string,
    managerEmploymentProfileId:
      body.managerEmploymentProfileId as
        | string
        | null
        | undefined,
    linkedUserId:
      body.linkedUserId as
        | string
        | null
        | undefined,
    contractStatus:
      body.contractStatus as CreateEmploymentProfileCommand["contractStatus"],
    employmentStartDate:
      body.employmentStartDate as number | string,
    externalRef:
      body.externalRef as
        | string
        | null
        | undefined,
    titleDescription:
      body.titleDescription as
        | string
        | null
        | undefined,
  };
}

function parseUpdateEmploymentProfileCoreCommand(
  req: Request,
): UpdateEmploymentProfileCoreCommand {
  const body = requireRecord(req.body);
  assertAllowedBodyKeys(
    body,
    UPDATE_EMPLOYMENT_PROFILE_CORE_ALLOWED_BODY_KEYS,
    "EMPLOYMENT_PROFILE_UPDATE_CORE",
  );

  return {
    employmentProfileId: req.params.employmentProfileId,
    legalName: body.legalName as string | undefined,
    displayName:
      body.displayName as string | undefined,
    employmentKind:
      body.employmentKind as
        | UpdateEmploymentProfileCoreCommand["employmentKind"]
        | undefined,
    jobTitle: body.jobTitle as string | undefined,
    externalRef:
      body.externalRef as
        | string
        | null
        | undefined,
    titleDescription:
      body.titleDescription as
        | string
        | null
        | undefined,
  };
}

function parseAssignEmploymentProfileOrgUnitCommand(
  req: Request,
): AssignEmploymentProfileOrgUnitCommand {
  const body = requireRecord(req.body);
  assertAllowedBodyKeys(
    body,
    ASSIGN_EMPLOYMENT_PROFILE_ORG_UNIT_ALLOWED_BODY_KEYS,
    "EMPLOYMENT_PROFILE_ASSIGN_ORG_UNIT",
  );

  return {
    employmentProfileId: req.params.employmentProfileId,
    newOrgUnitId: body.newOrgUnitId as string,
  };
}

function parseAssignEmploymentProfileManagerCommand(
  req: Request,
): AssignEmploymentProfileManagerCommand {
  const body = requireRecord(req.body);
  assertAllowedBodyKeys(
    body,
    ASSIGN_EMPLOYMENT_PROFILE_MANAGER_ALLOWED_BODY_KEYS,
    "EMPLOYMENT_PROFILE_ASSIGN_MANAGER",
  );

  return {
    employmentProfileId: req.params.employmentProfileId,
    newManagerEmploymentProfileId:
      body.newManagerEmploymentProfileId as
        | string
        | null,
  };
}

function parseLinkEmploymentProfileUserCommand(
  req: Request,
): LinkEmploymentProfileUserCommand {
  const body = requireRecord(req.body);
  assertAllowedBodyKeys(
    body,
    LINK_EMPLOYMENT_PROFILE_USER_ALLOWED_BODY_KEYS,
    "EMPLOYMENT_PROFILE_LINK_USER",
  );

  return {
    employmentProfileId: req.params.employmentProfileId,
    linkedUserId: body.linkedUserId as string,
  };
}

function parseUnlinkEmploymentProfileUserCommand(
  req: Request,
): UnlinkEmploymentProfileUserCommand {
  const body =
    requirePlainObjectBodyForZeroBodyMutation(
      req.body,
      "EMPLOYMENT_PROFILE_UNLINK_USER",
    );
  assertAllowedBodyKeys(
    body,
    [],
    "EMPLOYMENT_PROFILE_UNLINK_USER",
  );

  return {
    employmentProfileId: req.params.employmentProfileId,
  };
}

function parsePlaceEmploymentProfileOnLeaveCommand(
  req: Request,
): PlaceEmploymentProfileOnLeaveCommand {
  const body =
    requirePlainObjectBodyForZeroBodyMutation(
      req.body,
      "EMPLOYMENT_PROFILE_PLACE_ON_LEAVE",
    );
  assertAllowedBodyKeys(
    body,
    [],
    "EMPLOYMENT_PROFILE_PLACE_ON_LEAVE",
  );

  return {
    employmentProfileId: req.params.employmentProfileId,
  };
}

function parseReturnEmploymentProfileFromLeaveCommand(
  req: Request,
): ReturnEmploymentProfileFromLeaveCommand {
  const body =
    requirePlainObjectBodyForZeroBodyMutation(
      req.body,
      "EMPLOYMENT_PROFILE_RETURN_FROM_LEAVE",
    );
  assertAllowedBodyKeys(
    body,
    [],
    "EMPLOYMENT_PROFILE_RETURN_FROM_LEAVE",
  );

  return {
    employmentProfileId: req.params.employmentProfileId,
  };
}

function parseSuspendEmploymentProfileCommand(
  req: Request,
): SuspendEmploymentProfileCommand {
  const body =
    requirePlainObjectBodyForZeroBodyMutation(
      req.body,
      "EMPLOYMENT_PROFILE_SUSPEND",
    );
  assertAllowedBodyKeys(
    body,
    [],
    "EMPLOYMENT_PROFILE_SUSPEND",
  );

  return {
    employmentProfileId: req.params.employmentProfileId,
  };
}

function parseReactivateEmploymentProfileCommand(
  req: Request,
): ReactivateEmploymentProfileCommand {
  const body =
    requirePlainObjectBodyForZeroBodyMutation(
      req.body,
      "EMPLOYMENT_PROFILE_REACTIVATE",
    );
  assertAllowedBodyKeys(
    body,
    [],
    "EMPLOYMENT_PROFILE_REACTIVATE",
  );

  return {
    employmentProfileId: req.params.employmentProfileId,
  };
}

function parseTerminateEmploymentProfileCommand(
  req: Request,
): TerminateEmploymentProfileCommand {
  const body = requireRecord(req.body);
  assertAllowedBodyKeys(
    body,
    TERMINATE_EMPLOYMENT_PROFILE_ALLOWED_BODY_KEYS,
    "EMPLOYMENT_PROFILE_TERMINATE",
  );

  return {
    employmentProfileId: req.params.employmentProfileId,
    employmentEndDate:
      body.employmentEndDate as number | string,
  };
}

function parseArchiveEmploymentProfileCommand(
  req: Request,
): ArchiveEmploymentProfileCommand {
  const body =
    requirePlainObjectBodyForZeroBodyMutation(
      req.body,
      "EMPLOYMENT_PROFILE_ARCHIVE",
    );
  assertAllowedBodyKeys(
    body,
    [],
    "EMPLOYMENT_PROFILE_ARCHIVE",
  );

  return {
    employmentProfileId: req.params.employmentProfileId,
  };
}

function parseUpdateEmploymentProfileContractStatusCommand(
  req: Request,
): UpdateEmploymentProfileContractStatusCommand {
  const body = requireRecord(req.body);
  assertAllowedBodyKeys(
    body,
    UPDATE_EMPLOYMENT_PROFILE_CONTRACT_STATUS_ALLOWED_BODY_KEYS,
    "EMPLOYMENT_PROFILE_UPDATE_CONTRACT_STATUS",
  );

  return {
    employmentProfileId: req.params.employmentProfileId,
    newContractStatus:
      body.newContractStatus as UpdateEmploymentProfileContractStatusCommand["newContractStatus"],
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
  mutation: EmploymentProfileMutationCommand,
): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new EmploymentProfileValidationError(
      `Request body for ${mutation} must be a plain object`,
    );
  }

  return value as Record<string, unknown>;
}

function assertAllowedBodyKeys(
  body: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
  mutation: EmploymentProfileMutationCommand,
): void {
  const allowed = new Set(allowedKeys);
  const unsupportedKeys = Object.keys(body).filter(
    (key) => !allowed.has(key),
  );

  if (unsupportedKeys.length === 0) {
    return;
  }

  unsupportedKeys.sort();

  throw new EmploymentProfileValidationError(
    `Unsupported field(s) for ${mutation}: ${unsupportedKeys.join(", ")}`,
  );
}
