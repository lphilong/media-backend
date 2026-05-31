import { Actor } from "@core/actor/actor";
import {
  EventAssignmentKind,
  EventByAssignmentListItemView,
} from "@modules/event-assignment/domain/event-assignment.types";
import { EventAssignmentReadRepository } from "@modules/event-assignment/read/event-assignment.read-repository";
import {
  SelfServiceValidationError,
} from "@modules/self-service/domain/self-service.errors";
import {
  SelfServiceEventListQuery,
  SelfServiceEventListView,
  SelfServiceEventView,
} from "@modules/self-service/domain/self-service.types";
import { SelfServiceIdentityResolver } from "@modules/self-service/shared/self-service.identity-resolver";

const MAX_LIMIT = 50;
const RECENT_PAST_DAYS = 30;
const UPCOMING_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1_000;

type DirectSelfServiceAssignmentKind = Extract<
  EventAssignmentKind,
  "EMPLOYMENT_PROFILE" | "TALENT"
>;

export class SelfServiceEventsService {
  constructor(
    private readonly identityResolver: SelfServiceIdentityResolver,
    private readonly eventAssignmentReadRepository: EventAssignmentReadRepository,
    private readonly clock: () => number = Date.now,
  ) {}

  async listCurrentEvents(
    actor: Actor,
    query: SelfServiceEventListQuery,
  ): Promise<SelfServiceEventListView> {
    const { employmentProfile, linkedInternalTalent } =
      await this.identityResolver.resolveEmploymentProfileWithLinkedInternalTalent(
        actor,
      );

    const now = this.clock();
    const operationalWindowStartAt = now - RECENT_PAST_DAYS * DAY_MS;
    const operationalWindowEndAt = now + UPCOMING_DAYS * DAY_MS;
    const requestedWindowStartAt = query.windowStartAt;
    const requestedWindowEndAt = query.windowEndAt;

    if (
      requestedWindowStartAt !== undefined &&
      requestedWindowEndAt !== undefined &&
      requestedWindowEndAt <= requestedWindowStartAt
    ) {
      throw new SelfServiceValidationError(
        "windowEndAt must be strictly later than windowStartAt",
      );
    }

    const windowStartAt =
      requestedWindowStartAt === undefined
        ? operationalWindowStartAt
        : Math.max(requestedWindowStartAt, operationalWindowStartAt);
    const windowEndAt =
      requestedWindowEndAt === undefined
        ? operationalWindowEndAt
        : Math.min(requestedWindowEndAt, operationalWindowEndAt);

    if (windowEndAt <= windowStartAt) {
      return {
        items: [],
        meta: buildMeta({
          windowStartAt,
          windowEndAt,
          limit: clampLimit(query.limit),
          truncated: false,
        }),
      };
    }

    const limit = clampLimit(query.limit);
    const repositoryLimit = limit + 1;
    const employmentProfileEventsPromise =
      this.eventAssignmentReadRepository.listEventsByAssignment({
        assignmentKind: "EMPLOYMENT_PROFILE",
        assignmentEmploymentProfileId: employmentProfile.id,
        assignmentTalentId: null,
        assignmentTalentGroupId: null,
        status: query.status,
        windowStartAt,
        windowEndAt,
        limit: repositoryLimit,
        sortField: "eventStartAt",
        sortDirection: "ASC",
      });
    const directTalentPromise =
      linkedInternalTalent
        ? this.eventAssignmentReadRepository.listEventsByAssignment({
            assignmentKind: "TALENT",
            assignmentEmploymentProfileId: null,
            assignmentTalentId: linkedInternalTalent.id,
            assignmentTalentGroupId: null,
            status: query.status,
            windowStartAt,
            windowEndAt,
            limit: repositoryLimit,
            sortField: "eventStartAt",
            sortDirection: "ASC",
          })
        : Promise.resolve({ items: [] });

    const [employmentProfileEvents, directTalentEvents] = await Promise.all([
      employmentProfileEventsPromise,
      directTalentPromise,
    ]);

    const mergedItems = mergeDirectAssignments([
        ...employmentProfileEvents.items.map((item) =>
          toSelfServiceEvent(item, "EMPLOYMENT_PROFILE"),
        ),
        ...directTalentEvents.items.map((item) =>
          toSelfServiceEvent(item, "TALENT"),
        ),
      ]);
    const truncated =
      mergedItems.length > limit ||
      employmentProfileEvents.items.length > limit ||
      directTalentEvents.items.length > limit;

    return {
      items: mergedItems.slice(0, limit),
      meta: buildMeta({
        windowStartAt,
        windowEndAt,
        limit,
        truncated,
      }),
    };
  }
}

function toSelfServiceEvent(
  item: EventByAssignmentListItemView,
  ownAssignmentKind: DirectSelfServiceAssignmentKind,
): SelfServiceEventView {
  return {
    eventId: item.id,
    eventCode: item.eventCode,
    title: item.title,
    status: item.status,
    startsAt: item.eventStartAt,
    endsAt: item.eventEndAt,
    ownAssignmentKind,
    ownAssignmentStatus: "ACTIVE",
  };
}

function mergeDirectAssignments(
  items: readonly SelfServiceEventView[],
): readonly SelfServiceEventView[] {
  const byEventId = new Map<string, SelfServiceEventView>();

  for (const item of items) {
    if (!byEventId.has(item.eventId)) {
      byEventId.set(item.eventId, item);
    }
  }

  return [...byEventId.values()].sort((left, right) => {
    if (left.startsAt !== right.startsAt) {
      return left.startsAt - right.startsAt;
    }

    return left.eventId.localeCompare(right.eventId);
  });
}

function clampLimit(value: number | undefined): number {
  if (value === undefined) {
    return MAX_LIMIT;
  }

  return Math.min(value, MAX_LIMIT);
}

function buildMeta(input: {
  readonly windowStartAt: number;
  readonly windowEndAt: number;
  readonly limit: number;
  readonly truncated: boolean;
}): SelfServiceEventListView["meta"] {
  return {
    window: {
      recentPastDays: RECENT_PAST_DAYS,
      upcomingDays: UPCOMING_DAYS,
      windowStartAt: input.windowStartAt,
      windowEndAt: input.windowEndAt,
    },
    limit: input.limit,
    truncated: input.truncated,
  };
}
