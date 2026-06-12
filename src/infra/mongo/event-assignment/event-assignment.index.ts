import {
  Collection,
  Db,
} from "mongodb";

export const EVENT_UNIQ_CODE_INDEX_NAME =
  "uniq_event_code";
export const EVENT_NORMALIZED_TITLE_INDEX_NAME =
  "idx_event_normalized_title";
export const EVENT_STATUS_WINDOW_INDEX_NAME =
  "idx_event_status_window";
export const EVENT_RESOURCE_STATUS_WINDOW_INDEX_NAME =
  "idx_event_resource_status_window";
export const EVENT_PLATFORM_STATUS_WINDOW_INDEX_NAME =
  "idx_event_platform_status_window";
export const EVENT_EVENT_START_AT_ID_INDEX_NAME =
  "idx_event_event_start_at";
export const EVENT_CREATED_AT_ID_INDEX_NAME =
  "idx_event_created_at";
export const EVENT_OWNER_STATUS_WINDOW_INDEX_NAME =
  "idx_event_owner_status_window";
export const STUDIO_BOOKING_EVENT_STATUS_INDEX_NAME =
  "idx_studio_booking_event_status";
export const STUDIO_BOOKING_RESOURCE_STATUS_WINDOW_INDEX_NAME =
  "idx_studio_booking_resource_status_window";

export const EVENT_ASSIGNMENT_ACTIVE_EMPLOYMENT_PROFILE_UNIQ_INDEX_NAME =
  "uniq_event_assignment_active_event_employment_profile";
export const EVENT_ASSIGNMENT_ACTIVE_TALENT_UNIQ_INDEX_NAME =
  "uniq_event_assignment_active_event_talent";
export const EVENT_ASSIGNMENT_ACTIVE_TALENT_GROUP_UNIQ_INDEX_NAME =
  "uniq_event_assignment_active_event_talent_group";
export const EVENT_ASSIGNMENT_EMPLOYMENT_PROFILE_STATUS_INDEX_NAME =
  "idx_event_assignment_employment_profile_status";
export const EVENT_ASSIGNMENT_TALENT_STATUS_INDEX_NAME =
  "idx_event_assignment_talent_status";
export const EVENT_ASSIGNMENT_TALENT_GROUP_STATUS_INDEX_NAME =
  "idx_event_assignment_talent_group_status";
export const EVENT_ASSIGNMENT_EVENT_STATUS_INDEX_NAME =
  "idx_event_assignment_event_status";
export const EVENT_ASSIGNMENT_KIND_STATUS_EVENT_INDEX_NAME =
  "idx_event_assignment_kind_status_event";

interface EventLegacyDocument {
  readonly _id: string;
  readonly title?: unknown;
}

export async function initEventAssignmentIndexes(
  db: Db,
): Promise<void> {
  const eventCollection =
    db.collection<EventLegacyDocument>("events");

  await backfillNormalizedTitle(eventCollection);

  await eventCollection.createIndex(
    {
      eventCode: 1,
    },
    {
      name: EVENT_UNIQ_CODE_INDEX_NAME,
      unique: true,
    },
  );

  await eventCollection.createIndex(
    {
      ownerEmploymentProfileId: 1,
      status: 1,
      eventStartAt: 1,
    },
    {
      name: EVENT_OWNER_STATUS_WINDOW_INDEX_NAME,
    },
  );

  await eventCollection.createIndex(
    {
      normalizedTitle: 1,
      _id: 1,
    },
    {
      name: EVENT_NORMALIZED_TITLE_INDEX_NAME,
    },
  );

  await eventCollection.createIndex(
    {
      status: 1,
      eventStartAt: 1,
      eventEndAt: 1,
    },
    {
      name: EVENT_STATUS_WINDOW_INDEX_NAME,
    },
  );

  await eventCollection.createIndex(
    {
      studioResourceIds: 1,
      status: 1,
      eventStartAt: 1,
      eventEndAt: 1,
    },
    {
      name: EVENT_RESOURCE_STATUS_WINDOW_INDEX_NAME,
    },
  );

  await eventCollection.createIndex(
    {
      platformAccountIds: 1,
      status: 1,
      eventStartAt: 1,
      eventEndAt: 1,
    },
    {
      name: EVENT_PLATFORM_STATUS_WINDOW_INDEX_NAME,
    },
  );

  await eventCollection.createIndex(
    {
      eventStartAt: 1,
      _id: 1,
    },
    {
      name: EVENT_EVENT_START_AT_ID_INDEX_NAME,
    },
  );

  await eventCollection.createIndex(
    {
      createdAt: 1,
      _id: 1,
    },
    {
      name: EVENT_CREATED_AT_ID_INDEX_NAME,
    },
  );

  const assignmentCollection =
    db.collection("event_assignments");

  await assignmentCollection.createIndex(
    {
      eventId: 1,
      assignmentEmploymentProfileId: 1,
    },
    {
      name:
        EVENT_ASSIGNMENT_ACTIVE_EMPLOYMENT_PROFILE_UNIQ_INDEX_NAME,
      unique: true,
      partialFilterExpression: {
        assignmentEmploymentProfileId: {
          $type: "string",
        },
        assignmentStatus: "ACTIVE",
      },
    },
  );

  await assignmentCollection.createIndex(
    {
      eventId: 1,
      assignmentTalentId: 1,
    },
    {
      name:
        EVENT_ASSIGNMENT_ACTIVE_TALENT_UNIQ_INDEX_NAME,
      unique: true,
      partialFilterExpression: {
        assignmentTalentId: {
          $type: "string",
        },
        assignmentStatus: "ACTIVE",
      },
    },
  );

  await assignmentCollection.createIndex(
    {
      eventId: 1,
      assignmentTalentGroupId: 1,
    },
    {
      name:
        EVENT_ASSIGNMENT_ACTIVE_TALENT_GROUP_UNIQ_INDEX_NAME,
      unique: true,
      partialFilterExpression: {
        assignmentTalentGroupId: {
          $type: "string",
        },
        assignmentStatus: "ACTIVE",
      },
    },
  );

  await assignmentCollection.createIndex(
    {
      assignmentEmploymentProfileId: 1,
      assignmentStatus: 1,
    },
    {
      name:
        EVENT_ASSIGNMENT_EMPLOYMENT_PROFILE_STATUS_INDEX_NAME,
      partialFilterExpression: {
        assignmentEmploymentProfileId: {
          $type: "string",
        },
      },
    },
  );

  await assignmentCollection.createIndex(
    {
      assignmentTalentId: 1,
      assignmentStatus: 1,
    },
    {
      name: EVENT_ASSIGNMENT_TALENT_STATUS_INDEX_NAME,
      partialFilterExpression: {
        assignmentTalentId: {
          $type: "string",
        },
      },
    },
  );

  await assignmentCollection.createIndex(
    {
      assignmentTalentGroupId: 1,
      assignmentStatus: 1,
    },
    {
      name:
        EVENT_ASSIGNMENT_TALENT_GROUP_STATUS_INDEX_NAME,
      partialFilterExpression: {
        assignmentTalentGroupId: {
          $type: "string",
        },
      },
    },
  );

  await assignmentCollection.createIndex(
    {
      eventId: 1,
      assignmentStatus: 1,
    },
    {
      name: EVENT_ASSIGNMENT_EVENT_STATUS_INDEX_NAME,
    },
  );

  await assignmentCollection.createIndex(
    {
      assignmentKind: 1,
      assignmentStatus: 1,
      eventId: 1,
    },
    {
      name:
        EVENT_ASSIGNMENT_KIND_STATUS_EVENT_INDEX_NAME,
    },
  );

  const studioBookingCollection = db.collection("studio_bookings");
  await studioBookingCollection.createIndex(
    { eventId: 1, status: 1, bookingStartAt: 1 },
    { name: STUDIO_BOOKING_EVENT_STATUS_INDEX_NAME },
  );
  await studioBookingCollection.createIndex(
    {
      studioResourceId: 1,
      status: 1,
      bookingStartAt: 1,
      bookingEndAt: 1,
    },
    { name: STUDIO_BOOKING_RESOURCE_STATUS_WINDOW_INDEX_NAME },
  );
}

async function backfillNormalizedTitle(
  collection: Collection<EventLegacyDocument>,
): Promise<void> {
  const cursor = collection.find(
    {
      normalizedTitle: {
        $exists: false,
      },
    },
    {
      projection: {
        _id: 1,
        title: 1,
      },
    },
  );

  const operations: Array<{
    updateOne: {
      filter: Record<string, unknown>;
      update: {
        $set: Record<string, unknown>;
      };
    };
  }> = [];

  for await (const document of cursor) {
    const title =
      typeof document.title === "string"
        ? document.title
        : "";

    operations.push({
      updateOne: {
        filter: {
          _id: document._id,
        },
        update: {
          $set: {
            normalizedTitle:
              canonicalizeEventTitle(title),
          },
        },
      },
    });

    if (operations.length >= 500) {
      await collection.bulkWrite(operations, {
        ordered: true,
      });
      operations.length = 0;
    }
  }

  if (operations.length > 0) {
    await collection.bulkWrite(operations, {
      ordered: true,
    });
  }
}

function canonicalizeEventTitle(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}
