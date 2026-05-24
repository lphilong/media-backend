export const REFERENCE_LOOKUP_DOMAINS = [
  "orgUnits",
  "employmentProfiles",
  "talents",
  "talentGroups",
  "platformAccounts",
  "studioResources",
  "events",
  "contractRecords",
  "revenueEntries",
  "commissionRules",
] as const;

export type ReferenceLookupDomain =
  (typeof REFERENCE_LOOKUP_DOMAINS)[number];

export interface ReferenceLookupQuery {
  readonly domain: ReferenceLookupDomain;
  readonly search?: string;
  readonly limit?: string | number;
}

export interface ReferenceLookupItem {
  readonly id: string;
  readonly label: string;
  readonly secondaryLabel?: string;
  readonly code?: string;
  readonly status?: string;
  readonly state?: string;
  readonly type?: string;
}

export interface ReferenceLookupResult {
  readonly items: readonly ReferenceLookupItem[];
}
