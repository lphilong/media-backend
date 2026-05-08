import { Request, Response, NextFunction } from "express";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { getActor } from "@core/actor/actor-context";
import { getContext } from "@core/context/context.middleware";
import { SystemInvariantError } from "@core/error/system-error";
import { ExposurePolicy } from "@core/exposure/exposure.policy";
import { assertHttpContext } from "@system/event-bridge/domain-event.guard";
import { assertPresentationResult } from "./presentation-result.assert";
import { PresentationResult } from "./presentation-result.types";

const GUARDED_RESPONSE_METHODS = [
  "append",
  "attachment",
  "clearCookie",
  "cookie",
  "download",
  "end",
  "flushHeaders",
  "header",
  "json",
  "jsonp",
  "links",
  "location",
  "redirect",
  "removeHeader",
  "render",
  "send",
  "sendFile",
  "sendStatus",
  "set",
  "setHeader",
  "status",
  "type",
  "vary",
  "write",
  "writeHead",
] as const;

type GuardedResponseMethod =
  (typeof GUARDED_RESPONSE_METHODS)[number];

type ResponseMethod = (
  ...args: readonly unknown[]
) => unknown;

type ResponseMethodStore = Map<
  GuardedResponseMethod,
  ResponseMethod
>;

function isResponseMethod(
  value: unknown,
): value is ResponseMethod {
  return typeof value === "function";
}

function createGuardedResponseMethod(params: {
  readonly res: Response;
  readonly originalMethod: ResponseMethod;
  readonly isWriteAllowed: () => boolean;
}): ResponseMethod {
  return (...args: readonly unknown[]) => {
    if (!params.isWriteAllowed()) {
      throw new SystemInvariantError(
        "HTTP_RESPONSE_SIDE_WRITE_FORBIDDEN",
        "HTTP response side-write forbidden",
      );
    }

    return Reflect.apply(
      params.originalMethod,
      params.res,
      args,
    );
  };
}

function installResponseSideWriteGuards(params: {
  readonly res: Response;
  readonly isWriteAllowed: () => boolean;
}): ResponseMethodStore {
  const originalMethods: ResponseMethodStore =
    new Map();

  for (const methodName of GUARDED_RESPONSE_METHODS) {
    const candidate = params.res[methodName];

    if (!isResponseMethod(candidate)) {
      continue;
    }

    originalMethods.set(methodName, candidate);

    Object.defineProperty(params.res, methodName, {
      value: createGuardedResponseMethod({
        res: params.res,
        originalMethod: candidate,
        isWriteAllowed: params.isWriteAllowed,
      }),
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }

  return originalMethods;
}

function restoreResponseMethods(
  res: Response,
  originalMethods: ResponseMethodStore,
): void {
  for (const [
    methodName,
    originalMethod,
  ] of originalMethods.entries()) {
    Object.defineProperty(res, methodName, {
      value: originalMethod,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
}

export abstract class SecureController {
  protected abstract handle(
    req: Request,
    actor: Actor,
    context: ContextType,
  ): Promise<unknown>;

  protected abstract present(
    result: unknown,
    req: Request,
    actor: Actor,
    context: ContextType,
  ): Promise<PresentationResult>;

  public readonly execute = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    let isControlledWriterStep = false;

    const originalMethods =
      installResponseSideWriteGuards({
        res,
        isWriteAllowed: () => isControlledWriterStep,
      });

    let caughtError: unknown;

    try {
      const actor = getActor(req);
      const context = assertHttpContext(
        getContext(req),
      );

      if (actor.context !== context) {
        throw new SystemInvariantError(
          "CONTEXT_VIOLATION",
          "Actor context does not match request context",
        );
      }

      const result = await this.handle(
        req,
        actor,
        context,
      );

      const presented = await this.present(
        result,
        req,
        actor,
        context,
      );

      const sanitized =
        ExposurePolicy.sanitize(presented);

      assertPresentationResult(sanitized);

      isControlledWriterStep = true;
      try {
        res.json(sanitized);
      } finally {
        isControlledWriterStep = false;
      }
    } catch (error) {
      caughtError = error;
    } finally {
      restoreResponseMethods(res, originalMethods);
    }

    if (caughtError) {
      next(caughtError);
    }
  };
}