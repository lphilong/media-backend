import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { PlatformAccountValidationError } from "@modules/platform-account/domain/platform-account.errors";
import { PLATFORM_ACCOUNT_ADMIN_MUTATION_PRESENTER_KEY } from "@modules/platform-account/shared/platform-account.presenter-keys";
import {
  ActivatePlatformAccountCommand,
  ArchivePlatformAccountCommand,
  CreatePlatformAccountCommand,
  DeactivatePlatformAccountCommand,
  TransferPlatformAccountOwnershipCommand,
  UpdatePlatformAccountCapabilitiesCommand,
  UpdatePlatformAccountCoreCommand,
} from "@modules/platform-account/shared/platform-account.contracts";
import { PlatformAccountAdminService } from "./admin.platform-account.service";

type PlatformAccountMutationCommand =
  | "PLATFORM_ACCOUNT_CREATE"
  | "PLATFORM_ACCOUNT_UPDATE_CORE"
  | "PLATFORM_ACCOUNT_TRANSFER_OWNERSHIP"
  | "PLATFORM_ACCOUNT_ACTIVATE"
  | "PLATFORM_ACCOUNT_DEACTIVATE"
  | "PLATFORM_ACCOUNT_ARCHIVE"
  | "PLATFORM_ACCOUNT_UPDATE_CAPABILITIES";

const CREATE_PLATFORM_ACCOUNT_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "accountCode",
    "platform",
    "platformSurfaceType",
    "displayName",
    "handle",
    "externalPlatformId",
    "profileUrl",
    "ownerKind",
    "ownerOrgUnitId",
    "ownerTalentId",
    "ownerTalentGroupId",
    "livestreamEnabled",
    "contentPublishingEnabled",
    "monetizationEnabled",
    "description",
    "externalRef",
  ]);

const UPDATE_PLATFORM_ACCOUNT_CORE_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "displayName",
    "handle",
    "externalPlatformId",
    "profileUrl",
    "description",
    "externalRef",
  ]);

const TRANSFER_PLATFORM_ACCOUNT_OWNERSHIP_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "ownerKind",
    "ownerOrgUnitId",
    "ownerTalentId",
    "ownerTalentGroupId",
  ]);

const UPDATE_PLATFORM_ACCOUNT_CAPABILITIES_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "livestreamEnabled",
    "contentPublishingEnabled",
    "monetizationEnabled",
  ]);

export class PlatformAccountAdminController extends SecureController {
  constructor(
    private readonly service: PlatformAccountAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<PlatformAccountMutationCommand>(
        req,
      );

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Platform account mutation command missing",
      );
    }

    switch (command) {
      case "PLATFORM_ACCOUNT_CREATE":
        return this.service.createPlatformAccount(
          actor,
          parseCreatePlatformAccountCommand(req),
        );

      case "PLATFORM_ACCOUNT_UPDATE_CORE":
        return this.service.updatePlatformAccountCore(
          actor,
          parseUpdatePlatformAccountCoreCommand(req),
        );

      case "PLATFORM_ACCOUNT_TRANSFER_OWNERSHIP":
        return this.service.transferPlatformAccountOwnership(
          actor,
          parseTransferPlatformAccountOwnershipCommand(
            req,
          ),
        );

      case "PLATFORM_ACCOUNT_ACTIVATE":
        return this.service.activatePlatformAccount(
          actor,
          parseActivatePlatformAccountCommand(req),
        );

      case "PLATFORM_ACCOUNT_DEACTIVATE":
        return this.service.deactivatePlatformAccount(
          actor,
          parseDeactivatePlatformAccountCommand(req),
        );

      case "PLATFORM_ACCOUNT_ARCHIVE":
        return this.service.archivePlatformAccount(
          actor,
          parseArchivePlatformAccountCommand(req),
        );

      case "PLATFORM_ACCOUNT_UPDATE_CAPABILITIES":
        return this.service.updatePlatformAccountCapabilities(
          actor,
          parseUpdatePlatformAccountCapabilitiesCommand(
            req,
          ),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported platform account mutation command: ${command}`,
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
        PLATFORM_ACCOUNT_ADMIN_MUTATION_PRESENTER_KEY,
      )
      .present(result, context);
  }
}

function parseCreatePlatformAccountCommand(
  req: Request,
): CreatePlatformAccountCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CREATE_PLATFORM_ACCOUNT_BODY_FIELDS,
    "createPlatformAccount",
  );

  return {
    accountCode: body.accountCode as string,
    platform:
      body.platform as CreatePlatformAccountCommand["platform"],
    platformSurfaceType:
      body.platformSurfaceType as CreatePlatformAccountCommand["platformSurfaceType"],
    displayName: body.displayName as string,
    handle:
      body.handle as string | null | undefined,
    externalPlatformId:
      body.externalPlatformId as
        | string
        | null
        | undefined,
    profileUrl:
      body.profileUrl as
        | string
        | null
        | undefined,
    ownerKind:
      body.ownerKind as CreatePlatformAccountCommand["ownerKind"],
    ownerOrgUnitId:
      body.ownerOrgUnitId as
        | string
        | null
        | undefined,
    ownerTalentId:
      body.ownerTalentId as
        | string
        | null
        | undefined,
    ownerTalentGroupId:
      body.ownerTalentGroupId as
        | string
        | null
        | undefined,
    livestreamEnabled:
      body.livestreamEnabled as boolean,
    contentPublishingEnabled:
      body.contentPublishingEnabled as boolean,
    monetizationEnabled:
      body.monetizationEnabled as boolean,
    description:
      body.description as
        | string
        | null
        | undefined,
    externalRef:
      body.externalRef as
        | string
        | null
        | undefined,
  };
}

function parseUpdatePlatformAccountCoreCommand(
  req: Request,
): UpdatePlatformAccountCoreCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_PLATFORM_ACCOUNT_CORE_BODY_FIELDS,
    "updatePlatformAccountCore",
  );

  return {
    platformAccountId:
      req.params.platformAccountId,
    displayName:
      body.displayName as string | undefined,
    handle:
      body.handle as string | null | undefined,
    externalPlatformId:
      body.externalPlatformId as
        | string
        | null
        | undefined,
    profileUrl:
      body.profileUrl as
        | string
        | null
        | undefined,
    description:
      body.description as
        | string
        | null
        | undefined,
    externalRef:
      body.externalRef as
        | string
        | null
        | undefined,
  };
}

function parseTransferPlatformAccountOwnershipCommand(
  req: Request,
): TransferPlatformAccountOwnershipCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    TRANSFER_PLATFORM_ACCOUNT_OWNERSHIP_BODY_FIELDS,
    "transferPlatformAccountOwnership",
  );

  return {
    platformAccountId:
      req.params.platformAccountId,
    ownerKind:
      body.ownerKind as TransferPlatformAccountOwnershipCommand["ownerKind"],
    ownerOrgUnitId:
      body.ownerOrgUnitId as
        | string
        | null
        | undefined,
    ownerTalentId:
      body.ownerTalentId as
        | string
        | null
        | undefined,
    ownerTalentGroupId:
      body.ownerTalentGroupId as
        | string
        | null
        | undefined,
  };
}

function parseActivatePlatformAccountCommand(
  req: Request,
): ActivatePlatformAccountCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "activatePlatformAccount",
  );

  return {
    platformAccountId:
      req.params.platformAccountId,
  };
}

function parseDeactivatePlatformAccountCommand(
  req: Request,
): DeactivatePlatformAccountCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "deactivatePlatformAccount",
  );

  return {
    platformAccountId:
      req.params.platformAccountId,
  };
}

function parseArchivePlatformAccountCommand(
  req: Request,
): ArchivePlatformAccountCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "archivePlatformAccount",
  );

  return {
    platformAccountId:
      req.params.platformAccountId,
  };
}

function parseUpdatePlatformAccountCapabilitiesCommand(
  req: Request,
): UpdatePlatformAccountCapabilitiesCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_PLATFORM_ACCOUNT_CAPABILITIES_BODY_FIELDS,
    "updatePlatformAccountCapabilities",
  );

  return {
    platformAccountId:
      req.params.platformAccountId,
    livestreamEnabled:
      body.livestreamEnabled as boolean,
    contentPublishingEnabled:
      body.contentPublishingEnabled as boolean,
    monetizationEnabled:
      body.monetizationEnabled as boolean,
  };
}

function requireRecord(
  value: unknown,
): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new PlatformAccountValidationError(
      "Request body must be a plain object",
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

  throw new PlatformAccountValidationError(
    `${mutationName} payload contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
