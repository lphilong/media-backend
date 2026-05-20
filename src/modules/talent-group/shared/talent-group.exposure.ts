import {
  PlainObject,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { ExposurePolicy } from "@core/exposure/exposure.policy";
import {
  TalentGroupByTalentListItemView,
  TalentGroupDetailView,
  TalentGroupListItemView,
  TalentGroupMemberListItemView,
  TalentGroupMemberMutationView,
  TalentGroupMutationView,
} from "@modules/talent-group/domain/talent-group.types";

const TALENT_GROUP_ADMIN_LIST_FIELDS = [
  "id",
  "groupCode",
  "name",
  "shortName",
  "status",
  "displayOrder",
  "createdAt",
  "updatedAt",
] as const;

const TALENT_GROUP_ADMIN_DETAIL_FIELDS = [
  "id",
  "groupCode",
  "name",
  "shortName",
  "description",
  "externalRef",
  "status",
  "displayOrder",
  "createdAt",
  "updatedAt",
] as const;

const TALENT_GROUP_MEMBER_FIELDS = [
  "id",
  "groupId",
  "talentId",
  "talentRef",
  "membershipStatus",
  "lineupOrder",
  "joinedAt",
  "leftAt",
  "createdAt",
  "updatedAt",
] as const;

const TALENT_GROUP_BY_TALENT_FIELDS = [
  "groupId",
  "id",
  "groupCode",
  "name",
  "shortName",
  "status",
  "displayOrder",
  "membershipId",
  "talentId",
  "talentRef",
  "membershipStatus",
  "lineupOrder",
  "joinedAt",
  "createdAt",
  "updatedAt",
] as const;

export const TalentGroupAdminListExposure =
  Object.freeze({
    expose(input: TalentGroupListItemView): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            groupCode: input.groupCode,
            name: input.name,
            shortName: input.shortName,
            status: input.status,
            displayOrder: input.displayOrder,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          TALENT_GROUP_ADMIN_LIST_FIELDS,
        ),
        "TalentGroupAdminList exposure",
      );
    },

    exposeMany(
      items: readonly TalentGroupListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const TalentGroupAdminDetailExposure =
  Object.freeze({
    expose(input: TalentGroupDetailView): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            groupCode: input.groupCode,
            name: input.name,
            shortName: input.shortName,
            description: input.description,
            externalRef: input.externalRef,
            status: input.status,
            displayOrder: input.displayOrder,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          TALENT_GROUP_ADMIN_DETAIL_FIELDS,
        ),
        "TalentGroupAdminDetail exposure",
      );
    },
  });

export const TalentGroupMemberExposure =
  Object.freeze({
    expose(
      input:
        | TalentGroupMemberListItemView
        | TalentGroupMemberMutationView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            groupId: input.groupId,
            talentId: input.talentId,
            talentRef: input.talentRef,
            membershipStatus:
              input.membershipStatus,
            lineupOrder: input.lineupOrder,
            joinedAt: input.joinedAt,
            leftAt: input.leftAt,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          TALENT_GROUP_MEMBER_FIELDS,
        ),
        "TalentGroupMember exposure",
      );
    },

    exposeMany(
      items: readonly TalentGroupMemberListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const TalentGroupByTalentExposure =
  Object.freeze({
    expose(
      input: TalentGroupByTalentListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            groupId: input.groupId,
            id: input.id,
            groupCode: input.groupCode,
            name: input.name,
            shortName: input.shortName,
            status: input.status,
            displayOrder: input.displayOrder,
            membershipId: input.membershipId,
            talentId: input.talentId,
            talentRef: input.talentRef,
            membershipStatus:
              input.membershipStatus,
            lineupOrder: input.lineupOrder,
            joinedAt: input.joinedAt,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          TALENT_GROUP_BY_TALENT_FIELDS,
        ),
        "TalentGroupByTalent exposure",
      );
    },

    exposeMany(
      items: readonly TalentGroupByTalentListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const TalentGroupAdminMutationExposure =
  Object.freeze({
    expose(
      input: TalentGroupMutationView,
    ): PlainObject {
      return TalentGroupAdminDetailExposure.expose(
        input,
      );
    },
  });
