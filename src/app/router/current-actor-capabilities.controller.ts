import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import {
  PresentationResult,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { Actor, ActorScopeGrants } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { AccountContext } from "@modules/account-context/domain/account-context.types";
import {
  WorkspaceAvailability,
  buildWorkspaceAvailability,
} from "@modules/account-context/account-context.workspace-availability";

type CurrentActorCapabilitiesCommand = "CURRENT_ACTOR_CAPABILITIES";

interface CurrentActorCapabilitiesSnapshot {
  readonly id: string;
  readonly type: string;
  readonly context: string;
  readonly isActive: boolean;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly scopeGrants: Readonly<ActorScopeGrants>;
  readonly accountContexts: readonly AccountContext[];
  readonly workspaceAvailability: WorkspaceAvailability;
  readonly generatedAt: string;
  readonly nextAuthorityTransitionAt: number | null;
  readonly capabilityRefreshAt: number | null;
}

export class CurrentActorCapabilitiesController extends SecureController {
  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<CurrentActorCapabilitiesSnapshot> {
    const command = readCommand<CurrentActorCapabilitiesCommand>(req);

    if (command !== "CURRENT_ACTOR_CAPABILITIES") {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Current actor capabilities command missing",
      );
    }

    return {
      id: actor.id,
      type: actor.type,
      context: actor.context,
      isActive: actor.isActive,
      roles: [...actor.roles],
      permissions: [...actor.permissions],
      scopeGrants: cloneScopeGrants(actor.scopeGrants),
      accountContexts: [...actor.accountContexts],
      workspaceAvailability: buildWorkspaceAvailability({
        accountContexts: actor.accountContexts,
        effectiveAccessTraceAvailable:
          actor.isActive &&
          actor.type === "admin" &&
          actor.accountContexts.includes("ADMIN_CONSOLE") &&
          actor.permissions.includes(Permission.ROLE_ASSIGNMENT_VIEW),
      }),
      generatedAt: new Date().toISOString(),
      nextAuthorityTransitionAt: actor.authorizationValidUntil ?? null,
      capabilityRefreshAt: actor.authorizationValidUntil ?? null,
    };
  }

  protected async present(
    result: CurrentActorCapabilitiesSnapshot,
    _req: Request,
    _actor: Actor,
    _context: ContextType,
  ): Promise<PresentationResult> {
    return {
      data: toPlainObject(result, "currentActorCapabilities"),
    };
  }
}

function cloneScopeGrants(
  scopeGrants: Readonly<ActorScopeGrants>,
): ActorScopeGrants {
  return {
    ...(scopeGrants.workSchedule
      ? { workSchedule: [...scopeGrants.workSchedule] }
      : {}),
    ...(scopeGrants.eventAssignment
      ? { eventAssignment: [...scopeGrants.eventAssignment] }
      : {}),
    ...(scopeGrants.contractRegistry
      ? { contractRegistry: [...scopeGrants.contractRegistry] }
      : {}),
    ...(scopeGrants.talentKpi ? { talentKpi: [...scopeGrants.talentKpi] } : {}),
    ...(scopeGrants.kpi ? { kpi: [...scopeGrants.kpi] } : {}),
    ...(scopeGrants.revenueLedger
      ? { revenueLedger: [...scopeGrants.revenueLedger] }
      : {}),
    ...(scopeGrants.commission
      ? { commission: [...scopeGrants.commission] }
      : {}),
    ...(scopeGrants.dashboardLite
      ? { dashboardLite: [...scopeGrants.dashboardLite] }
      : {}),
  };
}
