export const ACCOUNT_CONTEXTS = [
  "STAFF_CONSOLE",
  "MANAGER_CONSOLE",
  "ADMIN_CONSOLE",
] as const;

export type AccountContext = (typeof ACCOUNT_CONTEXTS)[number];

export const ACCOUNT_CONTEXT_SOURCE = "ACCOUNT_CONTEXT" as const;

const ACCOUNT_CONTEXT_SET = new Set<string>(ACCOUNT_CONTEXTS);

export function isAccountContext(value: unknown): value is AccountContext {
  return typeof value === "string" && ACCOUNT_CONTEXT_SET.has(value);
}

export function normalizeAccountContexts(
  value: unknown,
): readonly AccountContext[] {
  if (value === undefined || value === null) {
    return Object.freeze([]);
  }

  if (!Array.isArray(value)) {
    return Object.freeze([]);
  }

  const unique = new Set<AccountContext>();
  for (const entry of value) {
    if (isAccountContext(entry)) {
      unique.add(entry);
    }
  }

  return Object.freeze(
    ACCOUNT_CONTEXTS.filter((context) => unique.has(context)),
  );
}

