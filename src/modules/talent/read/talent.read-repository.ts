import {
  TalentCommercialParticipationStatus,
  TalentDetailView,
  TalentListItemView,
  TalentOperationalStatus,
  TalentOrigin,
  TalentSortDirection,
  TalentSortField,
} from "@modules/talent/domain/talent.types";

export interface ListTalentReadInput {
  readonly activeMemberOfGroupIds?: readonly string[];
  readonly operationalStatus?: TalentOperationalStatus;
  readonly talentOrigin?: TalentOrigin;
  readonly hasLinkedEmploymentProfile?: boolean;
  readonly commercialParticipationStatus?: TalentCommercialParticipationStatus;
  readonly livestreamEligible?: boolean;
  readonly eventEligible?: boolean;
  readonly limit: number;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortField?: TalentSortField;
  readonly sortDirection?: TalentSortDirection;
}

export interface ListTalentReadResult {
  readonly items: readonly TalentListItemView[];
  readonly nextCursor?: string;
}

export interface TalentReadRepository {
  listTalents(input: ListTalentReadInput): Promise<ListTalentReadResult>;

  getTalentDetail(talentId: string): Promise<TalentDetailView | null>;

  hasActiveMembershipInGroups(
    talentId: string,
    groupIds: readonly string[],
  ): Promise<boolean>;
}
