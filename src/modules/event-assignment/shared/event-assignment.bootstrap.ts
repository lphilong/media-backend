import { Db } from "mongodb";
import { SystemInvariantError } from "@core/error/system-error";
import {
  EVENT_ASSIGNMENT_ACTIVE_EMPLOYMENT_PROFILE_UNIQ_INDEX_NAME,
  EVENT_ASSIGNMENT_ACTIVE_TALENT_GROUP_UNIQ_INDEX_NAME,
  EVENT_ASSIGNMENT_ACTIVE_TALENT_UNIQ_INDEX_NAME,
  EVENT_ASSIGNMENT_EMPLOYMENT_PROFILE_STATUS_INDEX_NAME,
  EVENT_ASSIGNMENT_EVENT_STATUS_INDEX_NAME,
  EVENT_ASSIGNMENT_KIND_STATUS_EVENT_INDEX_NAME,
  EVENT_ASSIGNMENT_TALENT_GROUP_STATUS_INDEX_NAME,
  EVENT_ASSIGNMENT_TALENT_STATUS_INDEX_NAME,
  EVENT_CREATED_AT_ID_INDEX_NAME,
  EVENT_EVENT_START_AT_ID_INDEX_NAME,
  EVENT_NORMALIZED_TITLE_INDEX_NAME,
  EVENT_OWNER_STATUS_WINDOW_INDEX_NAME,
  EVENT_PLATFORM_STATUS_WINDOW_INDEX_NAME,
  EVENT_RESOURCE_STATUS_WINDOW_INDEX_NAME,
  EVENT_STATUS_WINDOW_INDEX_NAME,
  EVENT_UNIQ_CODE_INDEX_NAME,
  STUDIO_BOOKING_EVENT_STATUS_INDEX_NAME,
  STUDIO_BOOKING_RESOURCE_STATUS_WINDOW_INDEX_NAME,
  initEventAssignmentIndexes,
} from "@infra/mongo/event-assignment/event-assignment.index";
import { registerPresenters } from "./event-assignment.presenter.register";
import type { BootstrapRegistrar } from "@bootstrap/module-registrar";

interface IndexMetadata {
  readonly key?: unknown;
  readonly unique?: unknown;
  readonly partialFilterExpression?: unknown;
}

export function createEventAssignmentBootstrapRegistrar(): BootstrapRegistrar {
  return Object.freeze({
    name: "event-assignment",
    registerPresenters,
    async initIndexes(db: Db): Promise<void> {
      await initEventAssignmentIndexes(db);
    },
    async assertReadiness(db: Db): Promise<void> {
      await assertRequiredUniqueIndex(
        db,
        "events",
        EVENT_UNIQ_CODE_INDEX_NAME,
        {
          eventCode: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "events",
        EVENT_NORMALIZED_TITLE_INDEX_NAME,
        {
          normalizedTitle: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "events",
        EVENT_STATUS_WINDOW_INDEX_NAME,
        {
          status: 1,
          eventStartAt: 1,
          eventEndAt: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "events",
        EVENT_RESOURCE_STATUS_WINDOW_INDEX_NAME,
        {
          studioResourceIds: 1,
          status: 1,
          eventStartAt: 1,
          eventEndAt: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "events",
        EVENT_PLATFORM_STATUS_WINDOW_INDEX_NAME,
        {
          platformAccountIds: 1,
          status: 1,
          eventStartAt: 1,
          eventEndAt: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "events",
        EVENT_OWNER_STATUS_WINDOW_INDEX_NAME,
        {
          ownerEmploymentProfileId: 1,
          status: 1,
          eventStartAt: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "events",
        EVENT_EVENT_START_AT_ID_INDEX_NAME,
        {
          eventStartAt: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "events",
        EVENT_CREATED_AT_ID_INDEX_NAME,
        {
          createdAt: 1,
          _id: 1,
        },
      );

      await assertRequiredUniquePartialIndex(
        db,
        "event_assignments",
        EVENT_ASSIGNMENT_ACTIVE_EMPLOYMENT_PROFILE_UNIQ_INDEX_NAME,
        {
          eventId: 1,
          assignmentEmploymentProfileId: 1,
        },
        {
          assignmentEmploymentProfileId: {
            $type: "string",
          },
          assignmentStatus: "ACTIVE",
        },
      );

      await assertRequiredUniquePartialIndex(
        db,
        "event_assignments",
        EVENT_ASSIGNMENT_ACTIVE_TALENT_UNIQ_INDEX_NAME,
        {
          eventId: 1,
          assignmentTalentId: 1,
        },
        {
          assignmentTalentId: {
            $type: "string",
          },
          assignmentStatus: "ACTIVE",
        },
      );

      await assertRequiredUniquePartialIndex(
        db,
        "event_assignments",
        EVENT_ASSIGNMENT_ACTIVE_TALENT_GROUP_UNIQ_INDEX_NAME,
        {
          eventId: 1,
          assignmentTalentGroupId: 1,
        },
        {
          assignmentTalentGroupId: {
            $type: "string",
          },
          assignmentStatus: "ACTIVE",
        },
      );

      await assertRequiredPartialIndex(
        db,
        "event_assignments",
        EVENT_ASSIGNMENT_EMPLOYMENT_PROFILE_STATUS_INDEX_NAME,
        {
          assignmentEmploymentProfileId: 1,
          assignmentStatus: 1,
        },
        {
          assignmentEmploymentProfileId: {
            $type: "string",
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "event_assignments",
        EVENT_ASSIGNMENT_TALENT_STATUS_INDEX_NAME,
        {
          assignmentTalentId: 1,
          assignmentStatus: 1,
        },
        {
          assignmentTalentId: {
            $type: "string",
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "event_assignments",
        EVENT_ASSIGNMENT_TALENT_GROUP_STATUS_INDEX_NAME,
        {
          assignmentTalentGroupId: 1,
          assignmentStatus: 1,
        },
        {
          assignmentTalentGroupId: {
            $type: "string",
          },
        },
      );

      await assertRequiredIndex(
        db,
        "event_assignments",
        EVENT_ASSIGNMENT_EVENT_STATUS_INDEX_NAME,
        {
          eventId: 1,
          assignmentStatus: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "studio_bookings",
        STUDIO_BOOKING_EVENT_STATUS_INDEX_NAME,
        {
          eventId: 1,
          status: 1,
          bookingStartAt: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "studio_bookings",
        STUDIO_BOOKING_RESOURCE_STATUS_WINDOW_INDEX_NAME,
        {
          studioResourceId: 1,
          status: 1,
          bookingStartAt: 1,
          bookingEndAt: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "event_assignments",
        EVENT_ASSIGNMENT_KIND_STATUS_EVENT_INDEX_NAME,
        {
          assignmentKind: 1,
          assignmentStatus: 1,
          eventId: 1,
        },
      );
    },
  });
}

async function assertRequiredUniqueIndex(
  db: Db,
  collectionName: string,
  indexName: string,
  expectedKey: Record<string, number>,
): Promise<void> {
  const matched = await assertRequiredIndex(
    db,
    collectionName,
    indexName,
    expectedKey,
  );

  if (matched.unique !== true) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} on ${collectionName} must be unique`,
    );
  }
}

async function assertRequiredUniquePartialIndex(
  db: Db,
  collectionName: string,
  indexName: string,
  expectedKey: Record<string, number>,
  expectedPartialFilterExpression: Record<string, unknown>,
): Promise<void> {
  const matched = await assertRequiredIndex(
    db,
    collectionName,
    indexName,
    expectedKey,
  );

  if (matched.unique !== true) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} on ${collectionName} must be unique`,
    );
  }

  if (
    !hasDeepExactShape(
      matched.partialFilterExpression,
      expectedPartialFilterExpression,
    )
  ) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} on ${collectionName} has invalid partialFilterExpression`,
    );
  }
}

async function assertRequiredPartialIndex(
  db: Db,
  collectionName: string,
  indexName: string,
  expectedKey: Record<string, number>,
  expectedPartialFilterExpression: Record<string, unknown>,
): Promise<void> {
  const matched = await assertRequiredIndex(
    db,
    collectionName,
    indexName,
    expectedKey,
  );

  if (
    !hasDeepExactShape(
      matched.partialFilterExpression,
      expectedPartialFilterExpression,
    )
  ) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} on ${collectionName} has invalid partialFilterExpression`,
    );
  }
}

async function assertRequiredIndex(
  db: Db,
  collectionName: string,
  indexName: string,
  expectedKey: Record<string, number>,
): Promise<IndexMetadata> {
  const indexes = await db
    .collection(collectionName)
    .indexes();

  const matched = indexes.find((index) => {
    const name =
      typeof index.name === "string"
        ? index.name
        : undefined;

    return name === indexName;
  });

  if (!matched) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} missing on ${collectionName}`,
    );
  }

  if (!hasDeepExactShape(matched.key, expectedKey)) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} on ${collectionName} has invalid key shape`,
    );
  }

  return matched as IndexMetadata;
}

function hasDeepExactShape(
  candidate: unknown,
  expected: unknown,
): boolean {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof expected !== "object" ||
    expected === null
  ) {
    return Object.is(candidate, expected);
  }

  if (
    Array.isArray(candidate) ||
    Array.isArray(expected)
  ) {
    return false;
  }

  const candidateRecord = candidate as Record<string, unknown>;
  const expectedRecord = expected as Record<string, unknown>;
  const candidateKeys = Object.keys(candidateRecord);
  const expectedKeys = Object.keys(expectedRecord);

  if (candidateKeys.length !== expectedKeys.length) {
    return false;
  }

  for (const key of expectedKeys) {
    if (!(key in candidateRecord)) {
      return false;
    }

    if (
      !hasDeepExactShape(
        candidateRecord[key],
        expectedRecord[key],
      )
    ) {
      return false;
    }
  }

  return true;
}
