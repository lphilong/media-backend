import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import {
  ActivateUserCommand,
  ArchiveUserCommand,
  CreateUserCommand,
  DisableUserCommand,
  SetAuthLinkageCommand,
  UpdateUserCommand,
} from "@modules/user/shared/user.contracts";
import { UserValidationError } from "@modules/user/domain/user.errors";
import {
  USER_ADMIN_MUTATION_PRESENTER_KEY,
} from "@modules/user/shared/user.presenter-keys";
import { UserLifecycleService } from "./admin.user.service";

type UserMutationCommand =
  | "USER_CREATE"
  | "USER_UPDATE"
  | "USER_ACTIVATE"
  | "USER_DISABLE"
  | "USER_ARCHIVE"
  | "USER_AUTH_LINKAGE_SET";

const CREATE_USER_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "authSubject",
    "actorKind",
    "displayName",
    "email",
    "phone",
    "locale",
    "timezone",
  ]);

const UPDATE_USER_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "displayName",
    "email",
    "phone",
    "locale",
    "timezone",
  ]);

const SET_AUTH_LINKAGE_BODY_FIELDS: readonly string[] =
  Object.freeze(["provider", "subject"]);

export class UserAdminController extends SecureController {
  constructor(
    private readonly service: UserLifecycleService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<UserMutationCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "User mutation command missing",
      );
    }

    switch (command) {
      case "USER_CREATE":
        return this.service.createUser(
          actor,
          parseCreateUserCommand(req),
        );

      case "USER_UPDATE":
        return this.service.updateUser(
          actor,
          parseUpdateUserCommand(req),
        );

      case "USER_ACTIVATE":
        return this.service.activateUser(
          actor,
          parseActivateUserCommand(req),
        );

      case "USER_DISABLE":
        return this.service.disableUser(
          actor,
          parseDisableUserCommand(req),
        );

      case "USER_ARCHIVE":
        return this.service.archiveUser(
          actor,
          parseArchiveUserCommand(req),
        );

      case "USER_AUTH_LINKAGE_SET":
        return this.service.setAuthLinkage(
          actor,
          parseSetAuthLinkageCommand(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported user mutation command: ${command}`,
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
        USER_ADMIN_MUTATION_PRESENTER_KEY,
      )
      .present(result, context);
  }
}

function parseCreateUserCommand(
  req: Request,
): CreateUserCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CREATE_USER_BODY_FIELDS,
    "USER_CREATE",
  );

  return {
    authSubject: body.authSubject as string,
    actorKind: body.actorKind as
      | CreateUserCommand["actorKind"]
      | undefined,
    displayName: body.displayName as string,
    email: body.email as string | undefined,
    phone: body.phone as string | undefined,
    locale: body.locale as string | undefined,
    timezone: body.timezone as string | undefined,
  };
}

function parseUpdateUserCommand(
  req: Request,
): UpdateUserCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_USER_BODY_FIELDS,
    "USER_UPDATE",
  );

  return {
    userId: req.params.userId,
    displayName:
      body.displayName as
        | string
        | undefined,
    email: body.email as string | undefined,
    phone: body.phone as string | undefined,
    locale: body.locale as string | undefined,
    timezone: body.timezone as string | undefined,
  };
}

function parseActivateUserCommand(
  req: Request,
): ActivateUserCommand {
  assertNoUnexpectedFields(
    requirePlainObjectBodyForZeroBodyMutation(
      req.body,
      "USER_ACTIVATE",
    ),
    [],
    "USER_ACTIVATE",
  );

  return {
    userId: req.params.userId,
  };
}

function parseDisableUserCommand(
  req: Request,
): DisableUserCommand {
  assertNoUnexpectedFields(
    requirePlainObjectBodyForZeroBodyMutation(
      req.body,
      "USER_DISABLE",
    ),
    [],
    "USER_DISABLE",
  );

  return {
    userId: req.params.userId,
  };
}

function parseArchiveUserCommand(
  req: Request,
): ArchiveUserCommand {
  assertNoUnexpectedFields(
    requirePlainObjectBodyForZeroBodyMutation(
      req.body,
      "USER_ARCHIVE",
    ),
    [],
    "USER_ARCHIVE",
  );

  return {
    userId: req.params.userId,
  };
}

function parseSetAuthLinkageCommand(
  req: Request,
): SetAuthLinkageCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    SET_AUTH_LINKAGE_BODY_FIELDS,
    "USER_AUTH_LINKAGE_SET",
  );

  return {
    userId: req.params.userId,
    provider: body.provider as "auth0",
    subject: body.subject as string,
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
  command: UserMutationCommand,
): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new UserValidationError(
      `Request body for ${command} must be a plain object`,
    );
  }

  return value as Record<string, unknown>;
}

function assertNoUnexpectedFields(
  body: Readonly<Record<string, unknown>>,
  allowedFields: readonly string[],
  command: UserMutationCommand,
): void {
  const unexpectedFields = Object.keys(body).filter(
    (field) => !allowedFields.includes(field),
  );

  if (unexpectedFields.length === 0) {
    return;
  }

  unexpectedFields.sort();

  throw new UserValidationError(
    `${command} payload contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
