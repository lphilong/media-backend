import {
  PlainObject,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { ExposurePolicy } from "@core/exposure/exposure.policy";
import {
  EventAssignmentListItemView,
  EventByAssignmentListItemView,
  EventByPlatformListItemView,
  EventByResourceListItemView,
  EventDetailView,
  EventListItemView,
  EventMutationView,
} from "@modules/event-assignment/domain/event-assignment.types";

const EVENT_ADMIN_DETAIL_FIELDS = [
  "id",
  "eventCode",
  "title",
  "studioResourceIds",
  "platformAccountIds",
  "studioResourceRefs",
  "platformAccountRefs",
  "status",
  "eventStartAt",
  "eventEndAt",
  "description",
  "externalRef",
  "createdAt",
  "updatedAt",
] as const;

const EVENT_ADMIN_LIST_FIELDS = [
  "id",
  "eventCode",
  "title",
  "status",
  "eventStartAt",
  "eventEndAt",
  "createdAt",
] as const;

const EVENT_ADMIN_ASSIGNMENT_LIST_FIELDS = [
  "id",
  "eventId",
  "assignmentKind",
  "assignmentEmploymentProfileId",
  "assignmentTalentId",
  "assignmentTalentGroupId",
  "assignmentSubjectRef",
  "assignmentStatus",
  "createdAt",
] as const;

const EVENT_ADMIN_BY_ASSIGNMENT_LIST_FIELDS = [
  "id",
  "eventCode",
  "title",
  "status",
  "eventStartAt",
  "eventEndAt",
] as const;

const EVENT_ADMIN_BY_RESOURCE_LIST_FIELDS = [
  "id",
  "eventCode",
  "title",
  "status",
  "eventStartAt",
  "eventEndAt",
] as const;

const EVENT_ADMIN_BY_PLATFORM_LIST_FIELDS = [
  "id",
  "eventCode",
  "title",
  "status",
  "eventStartAt",
  "eventEndAt",
] as const;

export const EventAssignmentAdminDetailExposure = Object.freeze({
  expose(input: EventDetailView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          id: input.id,
          eventCode: input.eventCode,
          title: input.title,
          studioResourceIds: [...input.studioResourceIds],
          platformAccountIds: [...input.platformAccountIds],
          studioResourceRefs: input.studioResourceRefs,
          platformAccountRefs: input.platformAccountRefs,
          status: input.status,
          eventStartAt: input.eventStartAt,
          eventEndAt: input.eventEndAt,
          description: input.description,
          externalRef: input.externalRef,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
        },
        EVENT_ADMIN_DETAIL_FIELDS,
      ),
      "EventAssignmentAdminDetail exposure",
    );
  },
});

export const EventAssignmentAdminListExposure = Object.freeze({
  expose(input: EventListItemView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          id: input.id,
          eventCode: input.eventCode,
          title: input.title,
          status: input.status,
          eventStartAt: input.eventStartAt,
          eventEndAt: input.eventEndAt,
          createdAt: input.createdAt,
        },
        EVENT_ADMIN_LIST_FIELDS,
      ),
      "EventAssignmentAdminList exposure",
    );
  },

  exposeMany(items: readonly EventListItemView[]): readonly PlainObject[] {
    return items.map((item) => this.expose(item));
  },
});

export const EventAssignmentAdminAssignmentListExposure = Object.freeze({
  expose(input: EventAssignmentListItemView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          id: input.id,
          eventId: input.eventId,
          assignmentKind: input.assignmentKind,
          assignmentEmploymentProfileId: input.assignmentEmploymentProfileId,
          assignmentTalentId: input.assignmentTalentId,
          assignmentTalentGroupId: input.assignmentTalentGroupId,
          assignmentSubjectRef: input.assignmentSubjectRef,
          assignmentStatus: input.assignmentStatus,
          createdAt: input.createdAt,
        },
        EVENT_ADMIN_ASSIGNMENT_LIST_FIELDS,
      ),
      "EventAssignmentAdminAssignmentList exposure",
    );
  },

  exposeMany(
    items: readonly EventAssignmentListItemView[],
  ): readonly PlainObject[] {
    return items.map((item) => this.expose(item));
  },
});

export const EventAssignmentAdminByAssignmentListExposure = Object.freeze({
  expose(input: EventByAssignmentListItemView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          id: input.id,
          eventCode: input.eventCode,
          title: input.title,
          status: input.status,
          eventStartAt: input.eventStartAt,
          eventEndAt: input.eventEndAt,
        },
        EVENT_ADMIN_BY_ASSIGNMENT_LIST_FIELDS,
      ),
      "EventAssignmentAdminByAssignmentList exposure",
    );
  },

  exposeMany(
    items: readonly EventByAssignmentListItemView[],
  ): readonly PlainObject[] {
    return items.map((item) => this.expose(item));
  },
});

export const EventAssignmentAdminByResourceListExposure = Object.freeze({
  expose(input: EventByResourceListItemView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          id: input.id,
          eventCode: input.eventCode,
          title: input.title,
          status: input.status,
          eventStartAt: input.eventStartAt,
          eventEndAt: input.eventEndAt,
        },
        EVENT_ADMIN_BY_RESOURCE_LIST_FIELDS,
      ),
      "EventAssignmentAdminByResourceList exposure",
    );
  },

  exposeMany(
    items: readonly EventByResourceListItemView[],
  ): readonly PlainObject[] {
    return items.map((item) => this.expose(item));
  },
});

export const EventAssignmentAdminByPlatformListExposure = Object.freeze({
  expose(input: EventByPlatformListItemView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          id: input.id,
          eventCode: input.eventCode,
          title: input.title,
          status: input.status,
          eventStartAt: input.eventStartAt,
          eventEndAt: input.eventEndAt,
        },
        EVENT_ADMIN_BY_PLATFORM_LIST_FIELDS,
      ),
      "EventAssignmentAdminByPlatformList exposure",
    );
  },

  exposeMany(
    items: readonly EventByPlatformListItemView[],
  ): readonly PlainObject[] {
    return items.map((item) => this.expose(item));
  },
});

export const EventAssignmentAdminMutationExposure = Object.freeze({
  expose(input: EventMutationView): PlainObject {
    return EventAssignmentAdminDetailExposure.expose(input);
  },
});
