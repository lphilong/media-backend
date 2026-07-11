export interface PersistedRosterTarget {
  readonly kind: "ORG_UNIT" | "TALENT_GROUP";
  readonly id: string;
}

export function readPersistedRosterTarget(input: {
  readonly sourceRosterTargetType?: unknown;
  readonly sourceRosterTargetId?: unknown;
}): PersistedRosterTarget | null {
  const targetType = input.sourceRosterTargetType;
  if (targetType !== "ORG_UNIT" && targetType !== "TALENT_GROUP") {
    return null;
  }

  if (typeof input.sourceRosterTargetId !== "string") {
    return null;
  }

  const targetId = input.sourceRosterTargetId.trim();
  if (!targetId) {
    return null;
  }

  return { kind: targetType, id: targetId };
}

export function readExactRosterGeneratedTarget(input: {
  readonly sourceType?: unknown;
  readonly sourceRosterTargetType?: unknown;
  readonly sourceRosterTargetId?: unknown;
  readonly sourceRosterTargetMode?: unknown;
}): PersistedRosterTarget | null {
  if (
    input.sourceType !== "ROSTER_GENERATED" ||
    input.sourceRosterTargetMode !== "EXACT_ONLY"
  ) {
    return null;
  }

  return readPersistedRosterTarget(input);
}
