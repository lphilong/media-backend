import { Db } from "mongodb";
import { NativeMongoBusinessCodeSequenceRepository } from "@infra/mongo/business-code/business-code-sequence.repository";
import { NativeMongoStudioResourceReadRepository } from "@infra/mongo/studio-resource/studio-resource.read-repository";
import { NativeMongoStudioResourceWorkScheduleReadonlyAccess } from "@infra/mongo/work-schedule/work-schedule.readonly-access";
import { NativeMongoStudioResourceEventAssignmentReadonlyAccess } from "@infra/mongo/event-assignment/event-assignment.readonly-access";
import { NativeMongoStudioResourceRepository } from "@infra/mongo/studio-resource/studio-resource.repository";

export interface StudioResourceInfra {
  readonly studioResourceRepository: NativeMongoStudioResourceRepository;
  readonly businessCodeSequenceRepository: NativeMongoBusinessCodeSequenceRepository;
  readonly studioResourceReadRepository: NativeMongoStudioResourceReadRepository;
  readonly studioResourceWorkScheduleReadonlyAccess: NativeMongoStudioResourceWorkScheduleReadonlyAccess;
  readonly studioResourceEventAssignmentReadonlyAccess: NativeMongoStudioResourceEventAssignmentReadonlyAccess;
}

export function createStudioResourceInfra(
  db: Db,
): StudioResourceInfra {
  return {
    studioResourceRepository:
      new NativeMongoStudioResourceRepository(db),
    businessCodeSequenceRepository:
      new NativeMongoBusinessCodeSequenceRepository(db),
    studioResourceReadRepository:
      new NativeMongoStudioResourceReadRepository(
        db,
      ),
    studioResourceWorkScheduleReadonlyAccess:
      new NativeMongoStudioResourceWorkScheduleReadonlyAccess(
        db,
      ),
    studioResourceEventAssignmentReadonlyAccess:
      new NativeMongoStudioResourceEventAssignmentReadonlyAccess(
        db,
      ),
  };
}
