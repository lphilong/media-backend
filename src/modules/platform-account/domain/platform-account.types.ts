export const PLATFORM_ACCOUNT_PLATFORMS = [
  "TIKTOK",
  "YOUTUBE",
  "FACEBOOK",
  "INSTAGRAM",
] as const;

export type PlatformAccountPlatform =
  (typeof PLATFORM_ACCOUNT_PLATFORMS)[number];

export const PLATFORM_ACCOUNT_SURFACE_TYPES = [
  "ACCOUNT",
  "CHANNEL",
  "PAGE",
] as const;

export type PlatformAccountSurfaceType =
  (typeof PLATFORM_ACCOUNT_SURFACE_TYPES)[number];

export const PLATFORM_ACCOUNT_OWNER_KINDS = [
  "ORG_UNIT",
  "TALENT",
  "TALENT_GROUP",
] as const;

export type PlatformAccountOwnerKind =
  (typeof PLATFORM_ACCOUNT_OWNER_KINDS)[number];

export const PLATFORM_ACCOUNT_OPERATIONAL_STATUSES = [
  "ACTIVE",
  "INACTIVE",
  "ARCHIVED",
] as const;

export type PlatformAccountOperationalStatus =
  (typeof PLATFORM_ACCOUNT_OPERATIONAL_STATUSES)[number];

export const PLATFORM_ACCOUNT_SORT_FIELDS = [
  "accountCode",
  "displayName",
  "createdAt",
] as const;

export type PlatformAccountSortField =
  (typeof PLATFORM_ACCOUNT_SORT_FIELDS)[number];

export const PLATFORM_ACCOUNT_SORT_DIRECTIONS = [
  "ASC",
  "DESC",
] as const;

export type PlatformAccountSortDirection =
  (typeof PLATFORM_ACCOUNT_SORT_DIRECTIONS)[number];

export interface PlatformAccountRecord {
  readonly id: string;
  readonly accountCode: string;
  readonly platform: PlatformAccountPlatform;
  readonly platformSurfaceType: PlatformAccountSurfaceType;
  readonly displayName: string;
  readonly normalizedDisplayName: string;
  readonly handle: string | null;
  readonly normalizedHandle: string | null;
  readonly externalPlatformId: string | null;
  readonly profileUrl: string | null;
  readonly normalizedProfileUrl: string | null;
  readonly ownerKind: PlatformAccountOwnerKind;
  readonly ownerOrgUnitId: string | null;
  readonly ownerTalentId: string | null;
  readonly ownerTalentGroupId: string | null;
  readonly operationalStatus: PlatformAccountOperationalStatus;
  readonly livestreamEnabled: boolean;
  readonly contentPublishingEnabled: boolean;
  readonly monetizationEnabled: boolean;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface PlatformAccountListItemView {
  readonly id: string;
  readonly accountCode: string;
  readonly platform: PlatformAccountPlatform;
  readonly platformSurfaceType: PlatformAccountSurfaceType;
  readonly displayName: string;
  readonly handle: string | null;
  readonly externalPlatformId: string | null;
  readonly profileUrl: string | null;
  readonly ownerKind: PlatformAccountOwnerKind;
  readonly ownerOrgUnitId: string | null;
  readonly ownerTalentId: string | null;
  readonly ownerTalentGroupId: string | null;
  readonly operationalStatus: PlatformAccountOperationalStatus;
  readonly livestreamEnabled: boolean;
  readonly contentPublishingEnabled: boolean;
  readonly monetizationEnabled: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface PlatformAccountOwnerListItemView
  extends PlatformAccountListItemView {}

export interface PlatformAccountDetailView
  extends PlatformAccountListItemView {
  readonly description: string | null;
  readonly externalRef: string | null;
}

export interface PlatformAccountMutationView
  extends PlatformAccountDetailView {}
