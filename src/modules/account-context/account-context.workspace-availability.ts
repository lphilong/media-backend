import {
  ACCOUNT_CONTEXTS,
  ACCOUNT_CONTEXT_SOURCE,
  AccountContext,
  normalizeAccountContexts,
} from "./domain/account-context.types";

export interface WorkspaceAvailabilityEntry {
  readonly context: AccountContext;
  readonly available: boolean;
  readonly source: typeof ACCOUNT_CONTEXT_SOURCE;
  readonly reasonCodes: readonly string[];
  readonly trace: readonly Record<string, unknown>[];
}

export interface WorkspaceAvailability {
  readonly primaryWorkspace: AccountContext | null;
  readonly availableWorkspaces: readonly WorkspaceAvailabilityEntry[];
  readonly ownDataAvailable: boolean;
  readonly managerResponsibilitiesAvailable: boolean;
  readonly effectiveAccessTraceAvailable: boolean;
  readonly sourceTrace: readonly Record<string, unknown>[];
}

const WORKSPACE_PRIORITY: readonly AccountContext[] = Object.freeze([
  "ADMIN_CONSOLE",
  "MANAGER_CONSOLE",
  "STAFF_CONSOLE",
]);

export function buildWorkspaceAvailability(params: {
  readonly accountContexts: unknown;
  readonly effectiveAccessTraceAvailable?: boolean;
  readonly legacyActorKind?: string | null;
}): WorkspaceAvailability {
  const contexts = normalizeAccountContexts(params.accountContexts);
  const contextSet = new Set(contexts);
  const primaryWorkspace =
    WORKSPACE_PRIORITY.find((context) => contextSet.has(context)) ?? null;

  const availableWorkspaces = ACCOUNT_CONTEXTS.map((context) => {
    const available = contextSet.has(context);
    return {
      context,
      available,
      source: ACCOUNT_CONTEXT_SOURCE,
      reasonCodes: available
        ? ["ACCOUNT_CONTEXT_ACTIVE"]
        : ["ACCOUNT_CONTEXT_MISSING"],
      trace: [
        {
          source: ACCOUNT_CONTEXT_SOURCE,
          context,
          matched: available,
        },
      ],
    };
  });

  return Object.freeze({
    primaryWorkspace,
    availableWorkspaces,
    ownDataAvailable: contextSet.has("STAFF_CONSOLE"),
    managerResponsibilitiesAvailable: contextSet.has("MANAGER_CONSOLE"),
    effectiveAccessTraceAvailable:
      params.effectiveAccessTraceAvailable ?? false,
    sourceTrace: [
      {
        source: ACCOUNT_CONTEXT_SOURCE,
        accountContexts: contexts,
        primaryWorkspace,
      },
      ...(params.legacyActorKind
        ? [
            {
              source: "LEGACY_ACTOR_KIND",
              legacyActorKind: params.legacyActorKind,
              grantsWorkspaceAuthority: false,
            },
          ]
        : []),
    ],
  });
}

