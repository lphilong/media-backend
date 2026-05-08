import { ClientSession } from "mongodb";
import { PlatformAccountOperationalStatus } from "@modules/platform-account/domain/platform-account.types";

export interface EventAssignmentReferencedPlatformAccount {
  readonly id: string;
  readonly operationalStatus: PlatformAccountOperationalStatus;
  readonly livestreamEnabled: boolean;
  readonly contentPublishingEnabled: boolean;
}

export interface EventAssignmentPlatformAccountReadonlyAccess {
  findById(
    platformAccountId: string,
    session?: ClientSession,
  ): Promise<EventAssignmentReferencedPlatformAccount | null>;
}
