import {
  PlainObject,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { ExposurePolicy } from "@core/exposure/exposure.policy";
import {
  PlatformAccountDetailView,
  PlatformAccountListItemView,
  PlatformAccountMutationView,
} from "@modules/platform-account/domain/platform-account.types";

const PLATFORM_ACCOUNT_ADMIN_LIST_FIELDS = [
  "id",
  "accountCode",
  "platform",
  "platformSurfaceType",
  "displayName",
  "handle",
  "externalPlatformId",
  "profileUrl",
  "ownerKind",
  "ownerOrgUnitId",
  "ownerTalentId",
  "ownerTalentGroupId",
  "operationalStatus",
  "livestreamEnabled",
  "contentPublishingEnabled",
  "monetizationEnabled",
  "createdAt",
  "updatedAt",
] as const;

const PLATFORM_ACCOUNT_ADMIN_DETAIL_FIELDS = [
  "id",
  "accountCode",
  "platform",
  "platformSurfaceType",
  "displayName",
  "handle",
  "externalPlatformId",
  "profileUrl",
  "ownerKind",
  "ownerOrgUnitId",
  "ownerTalentId",
  "ownerTalentGroupId",
  "operationalStatus",
  "livestreamEnabled",
  "contentPublishingEnabled",
  "monetizationEnabled",
  "description",
  "externalRef",
  "createdAt",
  "updatedAt",
] as const;

export const PlatformAccountAdminListExposure =
  Object.freeze({
    expose(
      input: PlatformAccountListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            accountCode: input.accountCode,
            platform: input.platform,
            platformSurfaceType:
              input.platformSurfaceType,
            displayName: input.displayName,
            handle: input.handle,
            externalPlatformId:
              input.externalPlatformId,
            profileUrl: input.profileUrl,
            ownerKind: input.ownerKind,
            ownerOrgUnitId:
              input.ownerOrgUnitId,
            ownerTalentId: input.ownerTalentId,
            ownerTalentGroupId:
              input.ownerTalentGroupId,
            operationalStatus:
              input.operationalStatus,
            livestreamEnabled:
              input.livestreamEnabled,
            contentPublishingEnabled:
              input.contentPublishingEnabled,
            monetizationEnabled:
              input.monetizationEnabled,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          PLATFORM_ACCOUNT_ADMIN_LIST_FIELDS,
        ),
        "PlatformAccountAdminList exposure",
      );
    },

    exposeMany(
      items: readonly PlatformAccountListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const PlatformAccountAdminDetailExposure =
  Object.freeze({
    expose(
      input: PlatformAccountDetailView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            accountCode: input.accountCode,
            platform: input.platform,
            platformSurfaceType:
              input.platformSurfaceType,
            displayName: input.displayName,
            handle: input.handle,
            externalPlatformId:
              input.externalPlatformId,
            profileUrl: input.profileUrl,
            ownerKind: input.ownerKind,
            ownerOrgUnitId:
              input.ownerOrgUnitId,
            ownerTalentId: input.ownerTalentId,
            ownerTalentGroupId:
              input.ownerTalentGroupId,
            operationalStatus:
              input.operationalStatus,
            livestreamEnabled:
              input.livestreamEnabled,
            contentPublishingEnabled:
              input.contentPublishingEnabled,
            monetizationEnabled:
              input.monetizationEnabled,
            description: input.description,
            externalRef: input.externalRef,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          PLATFORM_ACCOUNT_ADMIN_DETAIL_FIELDS,
        ),
        "PlatformAccountAdminDetail exposure",
      );
    },
  });

export const PlatformAccountAdminMutationExposure =
  Object.freeze({
    expose(
      input: PlatformAccountMutationView,
    ): PlainObject {
      return PlatformAccountAdminDetailExposure.expose(
        input,
      );
    },
  });
