import { ClientSession } from "mongodb";
import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";
import {
  StudioResourceOperationalStatus,
  StudioResourceRecord,
} from "./studio-resource.types";

export interface UpdateStudioResourceCoreInput {
  readonly studioResourceId: string;
  readonly name?: string;
  readonly normalizedName?: string;
  readonly shortName?: string | null;
  readonly normalizedShortName?: string | null;
  readonly locationLabel?: string | null;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly maxOccupancy?: number | null;
  readonly updatedAt: number;
}

export interface TransitionStudioResourceOperationalStatusInput {
  readonly studioResourceId: string;
  readonly fromStatuses: readonly StudioResourceOperationalStatus[];
  readonly toStatus: StudioResourceOperationalStatus;
  readonly updatedAt: number;
}

export interface StudioResourceRepository {
  insert(
    studioResource: StudioResourceRecord,
    session: ClientSession,
  ): Promise<StudioResourceRecord>;

  findById(
    studioResourceId: string,
    session?: ClientSession,
  ): Promise<StudioResourceRecord | null>;

  findByResourceCode(
    resourceCode: string,
    session?: ClientSession,
  ): Promise<StudioResourceRecord | null>;

  findMaxGeneratedCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
    session?: ClientSession,
  ): Promise<number>;

  updateCore(
    input: UpdateStudioResourceCoreInput,
    session: ClientSession,
  ): Promise<StudioResourceRecord | null>;

  transitionOperationalStatus(
    input: TransitionStudioResourceOperationalStatusInput,
    session: ClientSession,
  ): Promise<StudioResourceRecord | null>;
}
