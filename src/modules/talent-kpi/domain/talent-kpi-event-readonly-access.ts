import { ClientSession } from "mongodb";
import { EventStatus } from "@modules/event-assignment/domain/event-assignment.types";

export interface TalentKpiReferencedEvent {
  readonly id: string;
  readonly status: EventStatus;
  readonly platformAccountIds: readonly string[];
}

export interface TalentKpiEventReadonlyAccess {
  findById(
    eventId: string,
    session?: ClientSession,
  ): Promise<TalentKpiReferencedEvent | null>;

  hasActiveTalentAssignment(
    eventId: string,
    talentId: string,
    session?: ClientSession,
  ): Promise<boolean>;
}
