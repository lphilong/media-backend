import { Request } from "express";
import { Actor } from "./actor";
import { SystemInvariantError } from "@core/error/system-error";

const ACTOR_SYMBOL = Symbol.for("SECURITY_ACTOR");

type ActorCarrier = Request & {
  [key: symbol]: unknown;
};

function toActorCarrier(req: Request): ActorCarrier {
  return req as ActorCarrier;
}

/**
 * Bind actor to request.
 * Must be executed exactly once.
 */
export function bindActor(req: Request, actor: Actor): void {
  const target = toActorCarrier(req);

  if (Reflect.has(target, ACTOR_SYMBOL)) {
    throw new SystemInvariantError(
      "ACTOR_ALREADY_BOUND",
      "Actor is already bound to this request",
    );
  }

  Object.defineProperty(target, ACTOR_SYMBOL, {
    value: Object.freeze(actor),
    enumerable: false,
    writable: false,
    configurable: false,
  });
}

/**
 * Read-only accessor for bound actor.
 */
export function getActor(req: Request): Actor {
  const target = toActorCarrier(req);
  const candidate = target[ACTOR_SYMBOL];

  if (!(candidate instanceof Actor)) {
    throw new SystemInvariantError(
      "ACTOR_NOT_BOUND",
      "Actor has not been resolved for this request",
    );
  }

  return candidate;
}