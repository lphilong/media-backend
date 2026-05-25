import { Actor } from "@core/actor/actor";
import { EmploymentProfileRepository } from "@modules/employment-profile/domain/employment-profile.repository";
import {
  EventAssignmentKind,
  EventByAssignmentListItemView,
} from "@modules/event-assignment/domain/event-assignment.types";
import { EventAssignmentReadRepository } from "@modules/event-assignment/read/event-assignment.read-repository";
import {
  SelfServiceCurrentPersonNotLinkedError,
  SelfServiceValidationError,
} from "@modules/self-service/domain/self-service.errors";
import {
  SelfServiceEventListQuery,
  SelfServiceEventListView,
  SelfServiceEventView,
} from "@modules/self-service/domain/self-service.types";
import { TalentRepository } from "@modules/talent/domain/talent.repository";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

type DirectSelfServiceAssignmentKind = Extract<
  EventAssignmentKind,
  "EMPLOYMENT_PROFILE" | "TALENT"
>;

export class SelfServiceEventsService {
  constructor(
    private readonly employmentProfileRepository: EmploymentProfileRepository,
    private readonly talentRepository: TalentRepository,
    private readonly eventAssignmentReadRepository: EventAssignmentReadRepository,
  ) {}

  async listCurrentEvents(
    actor: Actor,
    query: SelfServiceEventListQuery,
  ): Promise<SelfServiceEventListView> {
    const employmentProfile =
      await this.employmentProfileRepository.findNonArchivedByLinkedUserId(
        actor.id,
      );

    if (!employmentProfile) {
      throw new SelfServiceCurrentPersonNotLinkedError();
    }

    const windowStartAt = query.windowStartAt;
    const windowEndAt = query.windowEndAt;

    if (
      windowStartAt !== undefined &&
      windowEndAt !== undefined &&
      windowEndAt <= windowStartAt
    ) {
      throw new SelfServiceValidationError(
        "windowEndAt must be strictly later than windowStartAt",
      );
    }

    const linkedTalent =
      await this.talentRepository.findNonArchivedByLinkedEmploymentProfileId(
        employmentProfile.id,
      );
    const limit = clampLimit(query.limit);
    const employmentProfileEventsPromise =
      this.eventAssignmentReadRepository.listEventsByAssignment({
        assignmentKind: "EMPLOYMENT_PROFILE",
        assignmentEmploymentProfileId: employmentProfile.id,
        assignmentTalentId: null,
        assignmentTalentGroupId: null,
        status: query.status,
        windowStartAt,
        windowEndAt,
        limit,
        sortField: "eventStartAt",
        sortDirection: "ASC",
      });
    const directTalentPromise =
      linkedTalent?.talentOrigin === "INTERNAL" &&
      linkedTalent.linkedEmploymentProfileId === employmentProfile.id
        ? this.eventAssignmentReadRepository.listEventsByAssignment({
            assignmentKind: "TALENT",
            assignmentEmploymentProfileId: null,
            assignmentTalentId: linkedTalent.id,
            assignmentTalentGroupId: null,
            status: query.status,
            windowStartAt,
            windowEndAt,
            limit,
            sortField: "eventStartAt",
            sortDirection: "ASC",
          })
        : Promise.resolve({ items: [] });

    const [employmentProfileEvents, directTalentEvents] = await Promise.all([
      employmentProfileEventsPromise,
      directTalentPromise,
    ]);

    return {
      items: mergeDirectAssignments([
        ...employmentProfileEvents.items.map((item) =>
          toSelfServiceEvent(item, "EMPLOYMENT_PROFILE"),
        ),
        ...directTalentEvents.items.map((item) =>
          toSelfServiceEvent(item, "TALENT"),
        ),
      ]).slice(0, limit),
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
    return DEFAULT_LIMIT;
  }

  return Math.min(value, MAX_LIMIT);
}
