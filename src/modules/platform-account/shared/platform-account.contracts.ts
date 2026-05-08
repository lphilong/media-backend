import {
  PlatformAccountDetailView,
  PlatformAccountListItemView,
  PlatformAccountMutationView,
  PlatformAccountOperationalStatus,
  PlatformAccountOwnerKind,
  PlatformAccountPlatform,
  PlatformAccountSortDirection,
  PlatformAccountSortField,
  PlatformAccountSurfaceType,
} from "@modules/platform-account/domain/platform-account.types";

export interface CreatePlatformAccountCommand {
  readonly accountCode: string;
  readonly platform: PlatformAccountPlatform;
  readonly platformSurfaceType: PlatformAccountSurfaceType;
  readonly displayName: string;
  readonly handle?: string | null;
  readonly externalPlatformId?: string | null;
  readonly profileUrl?: string | null;
  readonly ownerKind: PlatformAccountOwnerKind;
  readonly ownerOrgUnitId?: string | null;
  readonly ownerTalentId?: string | null;
  readonly ownerTalentGroupId?: string | null;
  readonly livestreamEnabled: boolean;
  readonly contentPublishingEnabled: boolean;
  readonly monetizationEnabled: boolean;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export interface UpdatePlatformAccountCoreCommand {
  readonly platformAccountId: string;
  readonly displayName?: string;
  readonly handle?: string | null;
  readonly externalPlatformId?: string | null;
  readonly profileUrl?: string | null;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export interface TransferPlatformAccountOwnershipCommand {
  readonly platformAccountId: string;
  readonly ownerKind: PlatformAccountOwnerKind;
  readonly ownerOrgUnitId?: string | null;
  readonly ownerTalentId?: string | null;
  readonly ownerTalentGroupId?: string | null;
}

export interface ActivatePlatformAccountCommand {
  readonly platformAccountId: string;
}

export interface DeactivatePlatformAccountCommand {
  readonly platformAccountId: string;
}

export interface ArchivePlatformAccountCommand {
  readonly platformAccountId: string;
}

export interface UpdatePlatformAccountCapabilitiesCommand {
  readonly platformAccountId: string;
  readonly livestreamEnabled: boolean;
  readonly contentPublishingEnabled: boolean;
  readonly monetizationEnabled: boolean;
}

export interface GetPlatformAccountDetailQuery {
  readonly platformAccountId: string;
}

export interface ListPlatformAccountsQuery {
  readonly platform?: PlatformAccountPlatform | string;
  readonly platformSurfaceType?: PlatformAccountSurfaceType | string;
  readonly operationalStatus?: PlatformAccountOperationalStatus | string;
  readonly ownerKind?: PlatformAccountOwnerKind | string;
  readonly ownerOrgUnitId?: string;
  readonly ownerTalentId?: string;
  readonly ownerTalentGroupId?: string;
  readonly livestreamEnabled?: boolean | string;
  readonly contentPublishingEnabled?: boolean | string;
  readonly monetizationEnabled?: boolean | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortBy?: PlatformAccountSortField | string;
  readonly sortDirection?: PlatformAccountSortDirection | string;
}

export type PlatformAccountMutationResult =
  PlatformAccountMutationView;

export type GetPlatformAccountDetailResult =
  PlatformAccountDetailView;

export interface ListPlatformAccountsResult {
  readonly items: readonly PlatformAccountListItemView[];
  readonly nextCursor?: string;
}
