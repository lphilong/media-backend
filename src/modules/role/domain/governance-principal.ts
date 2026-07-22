export const GOVERNANCE_PRINCIPAL_TYPES = [
  "PRIMARY_OWNER",
  "SUCCESSOR_OWNER",
] as const;
export type GovernancePrincipalType =
  (typeof GOVERNANCE_PRINCIPAL_TYPES)[number];
export type GovernancePrincipalStatus =
  | "PENDING"
  | "ACTIVE"
  | "SUPERSEDED"
  | "REVOKED";

export interface GovernancePrincipalRecord {
  readonly principalId: string;
  readonly userId: string;
  readonly principalType: GovernancePrincipalType;
  readonly status: GovernancePrincipalStatus;
  readonly effectiveAt: number;
  readonly expiresAt: number | null;
  readonly predecessorPrincipalId: string | null;
  readonly successorPrincipalId: string | null;
  readonly createdBy: string;
  readonly approvedBy: string;
  readonly reason: string;
  readonly createdAt: number;
  readonly approvedAt: number;
  readonly proposalIdempotencyKey?: string;
  readonly proposalPayloadFingerprint?: string;
  readonly decisionIdempotencyKey?: string | null;
  readonly decisionPayloadFingerprint?: string | null;
  readonly activationIdempotencyKey?: string | null;
  readonly activationPayloadFingerprint?: string | null;
}

export interface GovernanceUserEligibility {
  readonly userId: string;
  readonly userActive: boolean;
  readonly authLinked: boolean;
  readonly accountEligible: boolean;
}

export interface GovernancePrincipalEligibility {
  readonly eligible: boolean;
  readonly blockers: readonly string[];
}

export function evaluateGovernancePrincipalEligibility(
  principal: GovernancePrincipalRecord | null,
  user: GovernanceUserEligibility | null,
  now: number,
): GovernancePrincipalEligibility {
  const blockers: string[] = [];
  if (!principal) return { eligible: false, blockers: ["PRINCIPAL_NOT_FOUND"] };
  if (!user || user.userId !== principal.userId) blockers.push("USER_IDENTITY_MISMATCH");
  if (principal.status !== "ACTIVE") blockers.push("PRINCIPAL_NOT_ACTIVE");
  if (!Number.isFinite(principal.effectiveAt) || principal.effectiveAt > now) {
    blockers.push("PRINCIPAL_NOT_YET_EFFECTIVE");
  }
  if (
    principal.expiresAt !== null &&
    (!Number.isFinite(principal.expiresAt) || principal.expiresAt <= now)
  ) {
    blockers.push("PRINCIPAL_EXPIRED");
  }
  if (!user?.userActive) blockers.push("USER_NOT_ACTIVE");
  if (!user?.authLinked) blockers.push("USER_NOT_LINKED");
  if (!user?.accountEligible) blockers.push("ACCOUNT_NOT_ELIGIBLE");
  if (!principal.reason.trim()) blockers.push("GOVERNANCE_REASON_REQUIRED");
  if (principal.createdBy === principal.approvedBy) {
    blockers.push("GOVERNANCE_MAKER_CHECKER_REQUIRED");
  }
  return { eligible: blockers.length === 0, blockers };
}

export function isActivePrimaryOwner(
  principal: GovernancePrincipalRecord | null,
  user: GovernanceUserEligibility | null,
  now: number,
): boolean {
  return (
    principal?.principalType === "PRIMARY_OWNER" &&
    evaluateGovernancePrincipalEligibility(principal, user, now).eligible
  );
}
