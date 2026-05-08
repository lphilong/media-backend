import {
  PlainObject,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { ExposurePolicy } from "@core/exposure/exposure.policy";
import {
  StudioResourceAvailabilityListItemView,
  StudioResourceDetailView,
  StudioResourceListItemView,
  StudioResourceMutationView,
} from "@modules/studio-resource/domain/studio-resource.types";

const STUDIO_RESOURCE_ADMIN_LIST_FIELDS = [
  "id",
  "resourceCode",
  "name",
  "shortName",
  "resourceClass",
  "operationalStatus",
  "locationLabel",
  "maxOccupancy",
  "createdAt",
] as const;

const STUDIO_RESOURCE_ADMIN_AVAILABILITY_LIST_FIELDS = [
  "id",
  "resourceCode",
  "name",
  "resourceClass",
  "operationalStatus",
  "maxOccupancy",
] as const;

const STUDIO_RESOURCE_ADMIN_DETAIL_FIELDS = [
  "id",
  "resourceCode",
  "name",
  "shortName",
  "resourceClass",
  "operationalStatus",
  "locationLabel",
  "description",
  "externalRef",
  "maxOccupancy",
  "createdAt",
  "updatedAt",
] as const;

export const StudioResourceAdminListExposure =
  Object.freeze({
    expose(
      input: StudioResourceListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            resourceCode: input.resourceCode,
            name: input.name,
            shortName: input.shortName,
            resourceClass: input.resourceClass,
            operationalStatus:
              input.operationalStatus,
            locationLabel: input.locationLabel,
            maxOccupancy: input.maxOccupancy,
            createdAt: input.createdAt,
          },
          STUDIO_RESOURCE_ADMIN_LIST_FIELDS,
        ),
        "StudioResourceAdminList exposure",
      );
    },

    exposeMany(
      items: readonly StudioResourceListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const StudioResourceAdminAvailabilityListExposure =
  Object.freeze({
    expose(
      input: StudioResourceAvailabilityListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            resourceCode: input.resourceCode,
            name: input.name,
            resourceClass: input.resourceClass,
            operationalStatus:
              input.operationalStatus,
            maxOccupancy: input.maxOccupancy,
          },
          STUDIO_RESOURCE_ADMIN_AVAILABILITY_LIST_FIELDS,
        ),
        "StudioResourceAdminAvailabilityList exposure",
      );
    },

    exposeMany(
      items: readonly StudioResourceAvailabilityListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const StudioResourceAdminDetailExposure =
  Object.freeze({
    expose(
      input: StudioResourceDetailView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            resourceCode: input.resourceCode,
            name: input.name,
            shortName: input.shortName,
            resourceClass: input.resourceClass,
            operationalStatus:
              input.operationalStatus,
            locationLabel: input.locationLabel,
            description: input.description,
            externalRef: input.externalRef,
            maxOccupancy: input.maxOccupancy,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          STUDIO_RESOURCE_ADMIN_DETAIL_FIELDS,
        ),
        "StudioResourceAdminDetail exposure",
      );
    },
  });

export const StudioResourceAdminMutationExposure =
  Object.freeze({
    expose(
      input: StudioResourceMutationView,
    ): PlainObject {
      return StudioResourceAdminDetailExposure.expose(
        input,
      );
    },
  });
