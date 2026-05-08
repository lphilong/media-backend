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
  readonly operationalStatus?: TalentOperationalStatus;
  readonly talentOrigin?: TalentOrigin;
  readonly managerEmploymentProfileId?: string;
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
  listTalents(
    input: ListTalentReadInput,
  ): Promise<ListTalentReadResult>;

  getTalentDetail(
    talentId: string,
  ): Promise<TalentDetailView | null>;
}
