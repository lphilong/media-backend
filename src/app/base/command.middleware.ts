import { Request, Response, NextFunction } from "express";
import { SystemInvariantError } from "@core/error/system-error";

export type AppCommand = string;

const COMMAND_SYMBOL = Symbol.for("APP_COMMAND");

type CommandCarrier = Request & {
  [key: symbol]: unknown;
};

function toCommandCarrier(req: Request): CommandCarrier {
  return req as CommandCarrier;
}

function assertCommandValue(
  command: AppCommand,
): asserts command is AppCommand {
  if (
    typeof command !== "string" ||
    command.trim().length === 0
  ) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "Command must be a non-empty string",
    );
  }
}

export function bindCommand<T extends AppCommand>(
  req: Request,
  command: T,
): void {
  assertCommandValue(command);

  const target = toCommandCarrier(req);

  if (
    Reflect.has(target, COMMAND_SYMBOL) ||
    Object.prototype.hasOwnProperty.call(
      target,
      "command",
    )
  ) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "Command already bound to request",
    );
  }

  Object.defineProperty(target, COMMAND_SYMBOL, {
    value: command,
    writable: false,
    enumerable: false,
    configurable: false,
  });
}

export function readCommand<
  T extends AppCommand = AppCommand,
>(req: Request): T | undefined {
  const target = toCommandCarrier(req);

  if (!Reflect.has(target, COMMAND_SYMBOL)) {
    if (
      Object.prototype.hasOwnProperty.call(
        target,
        "command",
      )
    ) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Legacy public request.command binding is forbidden",
      );
    }

    return undefined;
  }

  const candidate = target[COMMAND_SYMBOL];

  if (
    typeof candidate !== "string" ||
    candidate.trim().length === 0
  ) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "Invalid command binding on request",
    );
  }

  return candidate as T;
}

export function getCommand<
  T extends AppCommand = AppCommand,
>(req: Request): T {
  const command = readCommand<T>(req);

  if (!command) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "Command is not bound to request",
    );
  }

  return command;
}

export function withCommand<T extends AppCommand>(
  command: T,
) {
  return (
    req: Request,
    _res: Response,
    next: NextFunction,
  ) => {
    bindCommand(req, command);
    next();
  };
}