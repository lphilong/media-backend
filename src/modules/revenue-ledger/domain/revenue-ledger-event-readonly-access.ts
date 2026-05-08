import { ClientSession } from "mongodb";
import { EventStatus } from "@modules/event-assignment/domain/event-assignment.types";

export interface RevenueLedgerReferencedEvent {
  readonly id: string;
  readonly status: EventStatus;
  readonly platformAccountIds: readonly string[];
}

export interface RevenueLedgerEventReadonlyAccess {
  findById(
    eventId: string,
    session?: ClientSession,
  ): Promise<RevenueLedgerReferencedEvent | null>;

  hasActiveTalentAssignment(
    eventId: string,
    talentId: string,
    session?: ClientSession,
  ): Promise<boolean>;
}
