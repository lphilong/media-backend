import {
  PlatformAccountDetailView,
  PlatformAccountListItemView,
  PlatformAccountOperationalStatus,
  PlatformAccountOwnerKind,
  PlatformAccountPlatform,
  PlatformAccountSortDirection,
  PlatformAccountSortField,
  PlatformAccountSurfaceType,
} from "@modules/platform-account/domain/platform-account.types";

export interface ListPlatformAccountReadInput {
  readonly platform?: PlatformAccountPlatform;
  readonly platformSurfaceType?: PlatformAccountSurfaceType;
  readonly operationalStatus?: PlatformAccountOperationalStatus;
  readonly ownerKind?: PlatformAccountOwnerKind;
  readonly ownerOrgUnitId?: string;
  readonly ownerTalentId?: string;
  readonly ownerTalentGroupId?: string;
  readonly livestreamEnabled?: boolean;
  readonly contentPublishingEnabled?: boolean;
  readonly monetizationEnabled?: boolean;
  readonly limit: number;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortField?: PlatformAccountSortField;
  readonly sortDirection?: PlatformAccountSortDirection;
}

export interface ListPlatformAccountReadResult {
  readonly items: readonly PlatformAccountListItemView[];
  readonly nextCursor?: string;
}

export interface PlatformAccountReadRepository {
  listPlatformAccounts(
    input: ListPlatformAccountReadInput,
  ): Promise<ListPlatformAccountReadResult>;

  getPlatformAccountDetail(
    platformAccountId: string,
  ): Promise<PlatformAccountDetailView | null>;
}
