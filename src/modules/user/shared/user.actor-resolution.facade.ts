import {
  ResolveActorByAuthLinkageInput,
  ResolveActorByAuthLinkageResult,
} from "./user.contracts";
import { ActorScopeGrants } from "@core/actor/actor";
import { AccountContext } from "@modules/account-context/domain/account-context.types";
import {
  ResolvedActorUser,
  UserAccountStatus,
  UserActorKind,
} from "@modules/user/domain/user.types";
import {
  UserDuplicateAuthLinkageError,
  UserInactiveActorResolutionError,
  UserValidationError,
} from "@modules/user/domain/user.errors";

export interface UserAuthResolutionCandidate {
  readonly userId: string;
  readonly actorKind: UserActorKind;
  readonly accountStatus: UserAccountStatus;
  readonly accountContexts?: readonly AccountContext[];
  readonly permissions: readonly string[];
  readonly scopeGrants?: ActorScopeGrants;
  readonly authorizationValidUntil?: number;
}

export interface UserAuthResolutionRepository {
  findByAuthSubject(
    authSubject: string,
  ): Promise<readonly UserAuthResolutionCandidate[]>;
}

export class UserActorResolutionFacade {
  constructor(
    private readonly repository: UserAuthResolutionRepository,
  ) {}

  async resolveByAuthLinkage(
    input: ResolveActorByAuthLinkageInput,
  ): Promise<ResolveActorByAuthLinkageResult> {
    if (
      input.context !== "ADMIN" &&
      input.context !== "SELF_SERVICE"
    ) {
      throw new UserInactiveActorResolutionError(
        `context ${input.context}`,
      );
    }

    const authSubject = normalizeAuthSubject(
      input.authSubject,
    );

    const matches = await this.repository.findByAuthSubject(
      authSubject,
    );

    if (matches.length === 0) {
      throw new UserInactiveActorResolutionError(
        "missing user",
      );
    }

    if (matches.length > 1) {
      throw new UserDuplicateAuthLinkageError(
        authSubject,
      );
    }

    const candidate = matches[0];

    if (!candidate) {
      throw new UserInactiveActorResolutionError(
        "missing user",
      );
    }

    if (candidate.accountStatus !== "ACTIVE") {
      throw new UserInactiveActorResolutionError(
        `status ${candidate.accountStatus}`,
      );
    }

    const actor: ResolvedActorUser = {
      userId: candidate.userId,
      actorKind: candidate.actorKind,
      accountStatus: candidate.accountStatus,
      accountContexts: candidate.accountContexts ?? [],
      permissions: candidate.permissions,
      context: input.context,
      scopeGrants: candidate.scopeGrants,
      authorizationValidUntil: candidate.authorizationValidUntil,
    };

    return { actor };
  }
}

function normalizeAuthSubject(
  input: unknown,
): string {
  if (typeof input !== "string") {
    throw new UserValidationError(
      "authSubject must be a string",
    );
  }

  const normalized = input.trim();

  if (!normalized) {
    throw new UserValidationError(
      "authSubject is required",
    );
  }

  return normalized;
}
