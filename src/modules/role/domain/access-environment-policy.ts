export const ACCESS_DEPLOYMENT_ENVIRONMENTS = [
  "PRODUCTION",
  "STAGING",
  "DEVELOPMENT",
  "TEST",
] as const;
export type AccessDeploymentEnvironment =
  (typeof ACCESS_DEPLOYMENT_ENVIRONMENTS)[number];

export const NON_PRODUCTION_OWNER_ADMIN_REVIEW_MS = 30 * 24 * 60 * 60 * 1000;

export function parseAccessDeploymentEnvironment(
  value: string | undefined,
): AccessDeploymentEnvironment | null {
  switch (value?.trim().toLowerCase()) {
    case "production":
      return "PRODUCTION";
    case "staging":
      return "STAGING";
    case "development":
      return "DEVELOPMENT";
    case "test":
      return "TEST";
    default:
      return null;
  }
}

export function evaluateOwnerAdminEnvironmentEligibility(input: {
  readonly environment: AccessDeploymentEnvironment | null;
  readonly assignmentUserId: string;
  readonly primaryOwnerUserId: string | null;
  readonly primaryOwnerEligible: boolean;
  readonly reviewDeadline: number | null;
  readonly now: number;
}): { readonly eligible: boolean; readonly blockers: readonly string[] } {
  const blockers: string[] = [];
  if (input.environment === null) blockers.push("UNKNOWN_ENVIRONMENT");
  if (input.environment === "PRODUCTION") blockers.push("OWNER_ADMIN_PRODUCTION_PROHIBITED");
  if (!input.primaryOwnerEligible || !input.primaryOwnerUserId) {
    blockers.push("ACTIVE_PRIMARY_OWNER_REQUIRED");
  } else if (input.assignmentUserId !== input.primaryOwnerUserId) {
    blockers.push("OWNER_ADMIN_PRIMARY_OWNER_ONLY");
  }
  if (
    input.reviewDeadline === null ||
    !Number.isFinite(input.reviewDeadline) ||
    input.reviewDeadline <= input.now
  ) {
    blockers.push("OWNER_ADMIN_REVIEW_OVERDUE");
  }
  return { eligible: blockers.length === 0, blockers };
}

export function ownerAdminBootstrapAllowed(
  environment: AccessDeploymentEnvironment | null,
): boolean {
  return (
    environment === "DEVELOPMENT" ||
    environment === "TEST" ||
    environment === "STAGING"
  );
}

export const ownerAdminContributesAuthority = ownerAdminBootstrapAllowed;
