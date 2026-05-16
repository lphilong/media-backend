import { ClientSession } from "mongodb";
import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";
import {
  RevenueEntry,
  RevenueEntryStatus,
  RevenueKind,
} from "./revenue-ledger.types";

export interface UpdateRevenueEntryDraftCoreInput {
  readonly revenueEntryId: string;
  readonly title?: string;
  readonly normalizedTitle?: string;
  readonly subjectTalentId?: string;
  readonly attributionPlatformAccountId?: string | null;
  readonly attributionEventId?: string | null;
  readonly revenueKind?: RevenueKind;
  readonly currencyCode?: string;
  readonly recognizedAmount?: number;
  readonly recognizedAt?: number;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly updatedAt: number;
}

export interface TransitionRevenueEntryStatusInput {
  readonly revenueEntryId: string;
  readonly fromStatuses: readonly RevenueEntryStatus[];
  readonly toStatus: RevenueEntryStatus;
  readonly finalizedAt?: number | null;
  readonly reconciledAt?: number | null;
  readonly voidedAt?: number | null;
  readonly reconciliationReference?: string | null;
  readonly updatedAt: number;
}

export interface RevenueEntryRepository {
  insert(
    revenueEntry: RevenueEntry,
    session: ClientSession,
  ): Promise<RevenueEntry>;

  findById(
    revenueEntryId: string,
    session?: ClientSession,
  ): Promise<RevenueEntry | null>;

  findByRevenueEntryCode(
    revenueEntryCode: string,
    session?: ClientSession,
  ): Promise<RevenueEntry | null>;

  findMaxGeneratedRevenueEntryCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
    session?: ClientSession,
  ): Promise<number>;

  updateDraftCore(
    input: UpdateRevenueEntryDraftCoreInput,
    session: ClientSession,
  ): Promise<RevenueEntry | null>;

  transitionStatus(
    input: TransitionRevenueEntryStatusInput,
    session: ClientSession,
  ): Promise<RevenueEntry | null>;
}
