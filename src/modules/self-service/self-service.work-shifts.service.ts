import { Actor } from "@core/actor/actor";
import {
  SelfServiceValidationError,
} from "@modules/self-service/domain/self-service.errors";
import {
  SelfServiceWorkShiftListQuery,
  SelfServiceWorkShiftListView,
} from "@modules/self-service/domain/self-service.types";
import { SelfServiceIdentityResolver } from "@modules/self-service/shared/self-service.identity-resolver";
import { WorkShiftReadRepository } from "@modules/work-schedule/read/work-schedule.read-repository";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export class SelfServiceWorkShiftsService {
  constructor(
    private readonly identityResolver: SelfServiceIdentityResolver,
    private readonly workShiftReadRepository: WorkShiftReadRepository,
  ) {}

  async listCurrentWorkShifts(
    actor: Actor,
    query: SelfServiceWorkShiftListQuery,
  ): Promise<SelfServiceWorkShiftListView> {
    const { employmentProfile } =
      await this.identityResolver.resolveEmploymentProfile(actor);

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

    const result =
      await this.workShiftReadRepository.listWorkShifts({
        subjectKind: "EMPLOYMENT_PROFILE",
        subjectEmploymentProfileId: employmentProfile.id,
        status: query.status,
        windowStartAt,
        windowEndAt,
        limit: clampLimit(query.limit),
        cursor: query.cursor,
        sortField: "shiftStartAt",
        sortDirection: "ASC",
      });

    return {
      items: result.items.map((item) => ({
        workShiftId: item.id,
        title: item.title,
        status: item.status,
        startsAt: item.shiftStartAt,
        endsAt: item.shiftEndAt,
        sourceType: item.sourceType,
      })),
      nextCursor: result.nextCursor,
    };
  }
}

function clampLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }

  return Math.min(value, MAX_LIMIT);
}
