import {
  PlainObject,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { ExposurePolicy } from "@core/exposure/exposure.policy";
import {
  OrgUnitChildListItemView,
  OrgUnitDetailView,
  OrgUnitListItemView,
  OrgUnitMutationView,
} from "@modules/org-unit/domain/org-unit.types";

const ORG_UNIT_ADMIN_LIST_FIELDS = [
  "id",
  "code",
  "name",
  "type",
  "status",
  "parentOrgUnitId",
  "parentOrgUnitRef",
  "depth",
  "displayOrder",
  "createdAt",
] as const;

const ORG_UNIT_ADMIN_CHILD_LIST_FIELDS = [
  "id",
  "code",
  "name",
  "type",
  "status",
  "parentOrgUnitId",
  "parentOrgUnitRef",
  "depth",
  "displayOrder",
] as const;

const ORG_UNIT_ADMIN_DETAIL_FIELDS = [
  "id",
  "code",
  "name",
  "type",
  "status",
  "depth",
  "description",
  "externalRef",
  "parentOrgUnitId",
  "parentOrgUnitRef",
  "displayOrder",
  "createdAt",
  "updatedAt",
  "hierarchy",
] as const;

export const OrgUnitAdminListExposure =
  Object.freeze({
    expose(input: OrgUnitListItemView): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            code: input.code,
            name: input.name,
            type: input.type,
            status: input.status,
            parentOrgUnitId: input.parentOrgUnitId,
            parentOrgUnitRef: input.parentOrgUnitRef,
            depth: input.depth,
            displayOrder: input.displayOrder,
            createdAt: input.createdAt,
          },
          ORG_UNIT_ADMIN_LIST_FIELDS,
        ),
        "OrgUnitAdminList exposure",
      );
    },

    exposeMany(
      items: readonly (
        | OrgUnitListItemView
        | OrgUnitChildListItemView
      )[],
    ): readonly PlainObject[] {
      return items.map((item) =>
        "createdAt" in item
          ? this.expose(item)
          : OrgUnitAdminChildListExposure.expose(
              item,
            ),
      );
    },
  });

export const OrgUnitAdminChildListExposure =
  Object.freeze({
    expose(
      input: OrgUnitChildListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            code: input.code,
            name: input.name,
            type: input.type,
            status: input.status,
            parentOrgUnitId: input.parentOrgUnitId,
            parentOrgUnitRef: input.parentOrgUnitRef,
            depth: input.depth,
            displayOrder: input.displayOrder,
          },
          ORG_UNIT_ADMIN_CHILD_LIST_FIELDS,
        ),
        "OrgUnitAdminChildList exposure",
      );
    },
  });

export const OrgUnitAdminDetailExposure =
  Object.freeze({
    expose(input: OrgUnitDetailView): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            code: input.code,
            name: input.name,
            type: input.type,
            status: input.status,
            depth: input.depth,
            description: input.description,
            externalRef: input.externalRef,
            parentOrgUnitId: input.parentOrgUnitId,
            parentOrgUnitRef: input.parentOrgUnitRef,
            displayOrder: input.displayOrder,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
            hierarchy: {
              id: input.hierarchy.id,
              parentOrgUnitId:
                input.hierarchy.parentOrgUnitId,
              depth: input.hierarchy.depth,
              ancestorChain:
                input.hierarchy.ancestorChain,
            },
          },
          ORG_UNIT_ADMIN_DETAIL_FIELDS,
        ),
        "OrgUnitAdminDetail exposure",
      );
    },
  });

export const OrgUnitAdminMutationExposure =
  Object.freeze({
    expose(input: OrgUnitMutationView): PlainObject {
      return OrgUnitAdminDetailExposure.expose(input);
    },
  });
