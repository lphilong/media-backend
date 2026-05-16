import { ClientSession } from "mongodb";
import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";
import {
  PlatformAccountOperationalStatus,
  PlatformAccountOwnerKind,
  PlatformAccountPlatform,
  PlatformAccountRecord,
} from "./platform-account.types";

export interface FindLivePlatformAccountByNormalizedHandleInput {
  readonly platform: PlatformAccountPlatform;
  readonly normalizedHandle: string;
  readonly excludePlatformAccountId?: string;
}

export interface FindLivePlatformAccountByExternalPlatformIdInput {
  readonly platform: PlatformAccountPlatform;
  readonly externalPlatformId: string;
  readonly excludePlatformAccountId?: string;
}

export interface FindLivePlatformAccountByNormalizedProfileUrlInput {
  readonly platform: PlatformAccountPlatform;
  readonly normalizedProfileUrl: string;
  readonly excludePlatformAccountId?: string;
}

export interface UpdatePlatformAccountCoreInput {
  readonly platformAccountId: string;
  readonly displayName?: string;
  readonly normalizedDisplayName?: string;
  readonly handle?: string | null;
  readonly normalizedHandle?: string | null;
  readonly externalPlatformId?: string | null;
  readonly profileUrl?: string | null;
  readonly normalizedProfileUrl?: string | null;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly updatedAt: number;
}

export interface TransferPlatformAccountOwnershipInput {
  readonly platformAccountId: string;
  readonly ownerKind: PlatformAccountOwnerKind;
  readonly ownerOrgUnitId: string | null;
  readonly ownerTalentId: string | null;
  readonly ownerTalentGroupId: string | null;
  readonly updatedAt: number;
}

export interface TransitionPlatformAccountOperationalStatusInput {
  readonly platformAccountId: string;
  readonly fromStatuses: readonly PlatformAccountOperationalStatus[];
  readonly toStatus: PlatformAccountOperationalStatus;
  readonly livestreamEnabled?: boolean;
  readonly contentPublishingEnabled?: boolean;
  readonly monetizationEnabled?: boolean;
  readonly updatedAt: number;
}

export interface UpdatePlatformAccountCapabilitiesInput {
  readonly platformAccountId: string;
  readonly livestreamEnabled: boolean;
  readonly contentPublishingEnabled: boolean;
  readonly monetizationEnabled: boolean;
  readonly updatedAt: number;
}

export interface PlatformAccountRepository {
  insert(
    platformAccount: PlatformAccountRecord,
    session: ClientSession,
  ): Promise<PlatformAccountRecord>;

  findById(
    platformAccountId: string,
    session?: ClientSession,
  ): Promise<PlatformAccountRecord | null>;

  findByAccountCode(
    accountCode: string,
    session?: ClientSession,
  ): Promise<PlatformAccountRecord | null>;

  findMaxGeneratedCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
    session?: ClientSession,
  ): Promise<number>;

  findLiveByPlatformAndNormalizedHandle(
    input: FindLivePlatformAccountByNormalizedHandleInput,
    session?: ClientSession,
  ): Promise<PlatformAccountRecord | null>;

  findLiveByPlatformAndExternalPlatformId(
    input: FindLivePlatformAccountByExternalPlatformIdInput,
    session?: ClientSession,
  ): Promise<PlatformAccountRecord | null>;

  findLiveByPlatformAndNormalizedProfileUrl(
    input: FindLivePlatformAccountByNormalizedProfileUrlInput,
    session?: ClientSession,
  ): Promise<PlatformAccountRecord | null>;

  updateCore(
    input: UpdatePlatformAccountCoreInput,
    session: ClientSession,
  ): Promise<PlatformAccountRecord | null>;

  transferOwnership(
    input: TransferPlatformAccountOwnershipInput,
    session: ClientSession,
  ): Promise<PlatformAccountRecord | null>;

  transitionOperationalStatus(
    input: TransitionPlatformAccountOperationalStatusInput,
    session: ClientSession,
  ): Promise<PlatformAccountRecord | null>;

  updateCapabilities(
    input: UpdatePlatformAccountCapabilitiesInput,
    session: ClientSession,
  ): Promise<PlatformAccountRecord | null>;
}
