import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { StudioResourceValidationError } from "@modules/studio-resource/domain/studio-resource.errors";
import { STUDIO_RESOURCE_ADMIN_MUTATION_PRESENTER_KEY } from "@modules/studio-resource/shared/studio-resource.presenter-keys";
import {
  ActivateStudioResourceCommand,
  ArchiveStudioResourceCommand,
  CreateStudioResourceCommand,
  DeactivateStudioResourceCommand,
  MarkStudioResourceOutOfServiceCommand,
  RestoreStudioResourceToActiveCommand,
  UpdateStudioResourceCoreCommand,
} from "@modules/studio-resource/shared/studio-resource.contracts";
import { StudioResourceAdminService } from "./admin.studio-resource.service";

type StudioResourceMutationCommand =
  | "STUDIO_RESOURCE_CREATE"
  | "STUDIO_RESOURCE_UPDATE_CORE"
  | "STUDIO_RESOURCE_MARK_OUT_OF_SERVICE"
  | "STUDIO_RESOURCE_RESTORE_TO_ACTIVE"
  | "STUDIO_RESOURCE_DEACTIVATE"
  | "STUDIO_RESOURCE_ACTIVATE"
  | "STUDIO_RESOURCE_ARCHIVE";

const CREATE_STUDIO_RESOURCE_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "resourceCode",
    "name",
    "resourceClass",
    "shortName",
    "locationLabel",
    "description",
    "externalRef",
    "maxOccupancy",
  ]);

const UPDATE_STUDIO_RESOURCE_CORE_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "name",
    "shortName",
    "locationLabel",
    "description",
    "externalRef",
    "maxOccupancy",
  ]);

export class StudioResourceAdminController extends SecureController {
  constructor(
    private readonly service: StudioResourceAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<StudioResourceMutationCommand>(
        req,
      );

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Studio resource mutation command missing",
      );
    }

    switch (command) {
      case "STUDIO_RESOURCE_CREATE":
        return this.service.createStudioResource(
          actor,
          parseCreateStudioResourceCommand(req),
        );

      case "STUDIO_RESOURCE_UPDATE_CORE":
        return this.service.updateStudioResourceCore(
          actor,
          parseUpdateStudioResourceCoreCommand(req),
        );

      case "STUDIO_RESOURCE_MARK_OUT_OF_SERVICE":
        return this.service.markStudioResourceOutOfService(
          actor,
          parseMarkStudioResourceOutOfServiceCommand(
            req,
          ),
        );

      case "STUDIO_RESOURCE_RESTORE_TO_ACTIVE":
        return this.service.restoreStudioResourceToActive(
          actor,
          parseRestoreStudioResourceToActiveCommand(
            req,
          ),
        );

      case "STUDIO_RESOURCE_DEACTIVATE":
        return this.service.deactivateStudioResource(
          actor,
          parseDeactivateStudioResourceCommand(req),
        );

      case "STUDIO_RESOURCE_ACTIVATE":
        return this.service.activateStudioResource(
          actor,
          parseActivateStudioResourceCommand(req),
        );

      case "STUDIO_RESOURCE_ARCHIVE":
        return this.service.archiveStudioResource(
          actor,
          parseArchiveStudioResourceCommand(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported studio resource mutation command: ${command}`,
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
        STUDIO_RESOURCE_ADMIN_MUTATION_PRESENTER_KEY,
      )
      .present(result, context);
  }
}

function parseCreateStudioResourceCommand(
  req: Request,
): CreateStudioResourceCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CREATE_STUDIO_RESOURCE_BODY_FIELDS,
    "createStudioResource",
  );

  return {
    resourceCode: body.resourceCode as string,
    name: body.name as string,
    resourceClass:
      body.resourceClass as CreateStudioResourceCommand["resourceClass"],
    shortName:
      body.shortName as string | null | undefined,
    locationLabel:
      body.locationLabel as
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
    maxOccupancy:
      body.maxOccupancy as number | null | undefined,
  };
}

function parseUpdateStudioResourceCoreCommand(
  req: Request,
): UpdateStudioResourceCoreCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_STUDIO_RESOURCE_CORE_BODY_FIELDS,
    "updateStudioResourceCore",
  );

  return {
    studioResourceId: req.params.studioResourceId,
    name: body.name as string | undefined,
    shortName:
      body.shortName as string | null | undefined,
    locationLabel:
      body.locationLabel as
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
    maxOccupancy:
      body.maxOccupancy as number | null | undefined,
  };
}

function parseMarkStudioResourceOutOfServiceCommand(
  req: Request,
): MarkStudioResourceOutOfServiceCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "markStudioResourceOutOfService",
  );

  return {
    studioResourceId: req.params.studioResourceId,
  };
}

function parseRestoreStudioResourceToActiveCommand(
  req: Request,
): RestoreStudioResourceToActiveCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "restoreStudioResourceToActive",
  );

  return {
    studioResourceId: req.params.studioResourceId,
  };
}

function parseDeactivateStudioResourceCommand(
  req: Request,
): DeactivateStudioResourceCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "deactivateStudioResource",
  );

  return {
    studioResourceId: req.params.studioResourceId,
  };
}

function parseActivateStudioResourceCommand(
  req: Request,
): ActivateStudioResourceCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "activateStudioResource",
  );

  return {
    studioResourceId: req.params.studioResourceId,
  };
}

function parseArchiveStudioResourceCommand(
  req: Request,
): ArchiveStudioResourceCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "archiveStudioResource",
  );

  return {
    studioResourceId: req.params.studioResourceId,
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
    throw new StudioResourceValidationError(
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

  throw new StudioResourceValidationError(
    `${mutationName} payload contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
