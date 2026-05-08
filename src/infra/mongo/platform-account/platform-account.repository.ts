import { ClientSession, Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository";
import {
  FindLivePlatformAccountByExternalPlatformIdInput,
  FindLivePlatformAccountByNormalizedHandleInput,
  FindLivePlatformAccountByNormalizedProfileUrlInput,
  PlatformAccountRepository,
  TransferPlatformAccountOwnershipInput,
  TransitionPlatformAccountOperationalStatusInput,
  UpdatePlatformAccountCapabilitiesInput,
  UpdatePlatformAccountCoreInput,
} from "@modules/platform-account/domain/platform-account.repository";
import {
  PlatformAccountOperationalStatus,
  PlatformAccountOwnerKind,
  PlatformAccountPlatform,
  PlatformAccountRecord,
  PlatformAccountSurfaceType,
} from "@modules/platform-account/domain/platform-account.types";

interface PlatformAccountDocument {
  readonly _id: string;
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

export class NativeMongoPlatformAccountRepository
  extends BaseRepository<PlatformAccountDocument>
  implements PlatformAccountRepository
{
  constructor(db: Db) {
    super(db, "platform_accounts");
  }

  async insert(
    platformAccount: PlatformAccountRecord,
    session: ClientSession,
  ): Promise<PlatformAccountRecord> {
    await this.collection.insertOne(
      toPlatformAccountDocument(platformAccount),
      this.withSession(session),
    );

    return platformAccount;
  }

  async findById(
    platformAccountId: string,
    session?: ClientSession,
  ): Promise<PlatformAccountRecord | null> {
    const doc = await this.collection.findOne(
      { _id: platformAccountId },
      this.withSession(session),
    );

    return doc
      ? toPlatformAccountRecord(doc)
      : null;
  }

  async findByAccountCode(
    accountCode: string,
    session?: ClientSession,
  ): Promise<PlatformAccountRecord | null> {
    const doc = await this.collection.findOne(
      { accountCode },
      this.withSession(session),
    );

    return doc
      ? toPlatformAccountRecord(doc)
      : null;
  }

  async findLiveByPlatformAndNormalizedHandle(
    input: FindLivePlatformAccountByNormalizedHandleInput,
    session?: ClientSession,
  ): Promise<PlatformAccountRecord | null> {
    return this.findLiveByField(
      {
        platform: input.platform,
        normalizedHandle: input.normalizedHandle,
        excludePlatformAccountId:
          input.excludePlatformAccountId,
      },
      session,
    );
  }

  async findLiveByPlatformAndExternalPlatformId(
    input: FindLivePlatformAccountByExternalPlatformIdInput,
    session?: ClientSession,
  ): Promise<PlatformAccountRecord | null> {
    return this.findLiveByField(
      {
        platform: input.platform,
        externalPlatformId:
          input.externalPlatformId,
        excludePlatformAccountId:
          input.excludePlatformAccountId,
      },
      session,
    );
  }

  async findLiveByPlatformAndNormalizedProfileUrl(
    input: FindLivePlatformAccountByNormalizedProfileUrlInput,
    session?: ClientSession,
  ): Promise<PlatformAccountRecord | null> {
    return this.findLiveByField(
      {
        platform: input.platform,
        normalizedProfileUrl:
          input.normalizedProfileUrl,
        excludePlatformAccountId:
          input.excludePlatformAccountId,
      },
      session,
    );
  }

  async updateCore(
    input: UpdatePlatformAccountCoreInput,
    session: ClientSession,
  ): Promise<PlatformAccountRecord | null> {
    const set: Record<string, unknown> = {
      updatedAt: input.updatedAt,
    };

    if (input.displayName !== undefined) {
      set.displayName = input.displayName;
    }

    if (input.normalizedDisplayName !== undefined) {
      set.normalizedDisplayName =
        input.normalizedDisplayName;
    }

    if (input.handle !== undefined) {
      set.handle = input.handle;
    }

    if (input.normalizedHandle !== undefined) {
      set.normalizedHandle =
        input.normalizedHandle;
    }

    if (input.externalPlatformId !== undefined) {
      set.externalPlatformId =
        input.externalPlatformId;
    }

    if (input.profileUrl !== undefined) {
      set.profileUrl = input.profileUrl;
    }

    if (input.normalizedProfileUrl !== undefined) {
      set.normalizedProfileUrl =
        input.normalizedProfileUrl;
    }

    if (input.description !== undefined) {
      set.description = input.description;
    }

    if (input.externalRef !== undefined) {
      set.externalRef = input.externalRef;
    }

    const updated = await this.collection.findOneAndUpdate(
      { _id: input.platformAccountId },
      {
        $set: set,
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated
      ? toPlatformAccountRecord(updated)
      : null;
  }

  async transferOwnership(
    input: TransferPlatformAccountOwnershipInput,
    session: ClientSession,
  ): Promise<PlatformAccountRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      { _id: input.platformAccountId },
      {
        $set: {
          ownerKind: input.ownerKind,
          ownerOrgUnitId: input.ownerOrgUnitId,
          ownerTalentId: input.ownerTalentId,
          ownerTalentGroupId:
            input.ownerTalentGroupId,
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated
      ? toPlatformAccountRecord(updated)
      : null;
  }

  async transitionOperationalStatus(
    input: TransitionPlatformAccountOperationalStatusInput,
    session: ClientSession,
  ): Promise<PlatformAccountRecord | null> {
    const set: Record<string, unknown> = {
      operationalStatus: input.toStatus,
      updatedAt: input.updatedAt,
    };

    if (input.livestreamEnabled !== undefined) {
      set.livestreamEnabled =
        input.livestreamEnabled;
    }

    if (
      input.contentPublishingEnabled !== undefined
    ) {
      set.contentPublishingEnabled =
        input.contentPublishingEnabled;
    }

    if (input.monetizationEnabled !== undefined) {
      set.monetizationEnabled =
        input.monetizationEnabled;
    }

    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.platformAccountId,
        operationalStatus: {
          $in: [...input.fromStatuses],
        },
      },
      {
        $set: set,
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated
      ? toPlatformAccountRecord(updated)
      : null;
  }

  async updateCapabilities(
    input: UpdatePlatformAccountCapabilitiesInput,
    session: ClientSession,
  ): Promise<PlatformAccountRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      { _id: input.platformAccountId },
      {
        $set: {
          livestreamEnabled:
            input.livestreamEnabled,
          contentPublishingEnabled:
            input.contentPublishingEnabled,
          monetizationEnabled:
            input.monetizationEnabled,
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated
      ? toPlatformAccountRecord(updated)
      : null;
  }

  private async findLiveByField(
    params: {
      readonly platform: PlatformAccountPlatform;
      readonly excludePlatformAccountId?: string;
      readonly normalizedHandle?: string;
      readonly externalPlatformId?: string;
      readonly normalizedProfileUrl?: string;
    },
    session?: ClientSession,
  ): Promise<PlatformAccountRecord | null> {
    const filter: Record<string, unknown> = {
      platform: params.platform,
      operationalStatus: {
        $ne: "ARCHIVED",
      },
    };

    if (params.normalizedHandle !== undefined) {
      filter.normalizedHandle =
        params.normalizedHandle;
    }

    if (params.externalPlatformId !== undefined) {
      filter.externalPlatformId =
        params.externalPlatformId;
    }

    if (params.normalizedProfileUrl !== undefined) {
      filter.normalizedProfileUrl =
        params.normalizedProfileUrl;
    }

    if (params.excludePlatformAccountId) {
      filter._id = {
        $ne: params.excludePlatformAccountId,
      };
    }

    const doc = await this.collection.findOne(
      filter,
      this.withSession(session),
    );

    return doc
      ? toPlatformAccountRecord(doc)
      : null;
  }
}

function toPlatformAccountDocument(
  platformAccount: PlatformAccountRecord,
): PlatformAccountDocument {
  return {
    _id: platformAccount.id,
    accountCode: platformAccount.accountCode,
    platform: platformAccount.platform,
    platformSurfaceType:
      platformAccount.platformSurfaceType,
    displayName: platformAccount.displayName,
    normalizedDisplayName:
      platformAccount.normalizedDisplayName,
    handle: platformAccount.handle,
    normalizedHandle:
      platformAccount.normalizedHandle,
    externalPlatformId:
      platformAccount.externalPlatformId,
    profileUrl: platformAccount.profileUrl,
    normalizedProfileUrl:
      platformAccount.normalizedProfileUrl,
    ownerKind: platformAccount.ownerKind,
    ownerOrgUnitId:
      platformAccount.ownerOrgUnitId,
    ownerTalentId: platformAccount.ownerTalentId,
    ownerTalentGroupId:
      platformAccount.ownerTalentGroupId,
    operationalStatus:
      platformAccount.operationalStatus,
    livestreamEnabled:
      platformAccount.livestreamEnabled,
    contentPublishingEnabled:
      platformAccount.contentPublishingEnabled,
    monetizationEnabled:
      platformAccount.monetizationEnabled,
    description: platformAccount.description,
    externalRef: platformAccount.externalRef,
    createdAt: platformAccount.createdAt,
    updatedAt: platformAccount.updatedAt,
  };
}

function toPlatformAccountRecord(
  document: PlatformAccountDocument,
): PlatformAccountRecord {
  return {
    id: document._id,
    accountCode: document.accountCode,
    platform: document.platform,
    platformSurfaceType:
      document.platformSurfaceType,
    displayName: document.displayName,
    normalizedDisplayName:
      document.normalizedDisplayName,
    handle: document.handle,
    normalizedHandle:
      document.normalizedHandle,
    externalPlatformId:
      document.externalPlatformId,
    profileUrl: document.profileUrl,
    normalizedProfileUrl:
      document.normalizedProfileUrl,
    ownerKind: document.ownerKind,
    ownerOrgUnitId: document.ownerOrgUnitId,
    ownerTalentId: document.ownerTalentId,
    ownerTalentGroupId:
      document.ownerTalentGroupId,
    operationalStatus:
      document.operationalStatus,
    livestreamEnabled:
      document.livestreamEnabled,
    contentPublishingEnabled:
      document.contentPublishingEnabled,
    monetizationEnabled:
      document.monetizationEnabled,
    description: document.description,
    externalRef: document.externalRef,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
