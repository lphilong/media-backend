import {
  TalentCommercialParticipationStatus,
  TalentDetailView,
  TalentListItemView,
  TalentMutationView,
  TalentOperationalStatus,
  TalentOrigin,
  TalentSortDirection,
  TalentSortField,
} from "@modules/talent/domain/talent.types";

export interface CreateTalentCommand {
  readonly talentCode?: string | null;
  readonly stageName: string;
  readonly legalName: string;
  readonly talentOrigin: TalentOrigin;
  readonly managerEmploymentProfileId?: string | null;
  readonly linkedEmploymentProfileId?: string | null;
  readonly commercialParticipationStatus: TalentCommercialParticipationStatus;
  readonly livestreamEligible: boolean;
  readonly eventEligible: boolean;
  readonly displayShortName?: string | null;
  readonly externalRef?: string | null;
  readonly profileSummary?: string | null;
}

export interface UpdateTalentCoreCommand {
  readonly talentId: string;
  readonly stageName?: string;
  readonly legalName?: string;
  readonly displayShortName?: string | null;
  readonly externalRef?: string | null;
  readonly profileSummary?: string | null;
}

export interface AssignTalentManagerCommand {
  readonly talentId: string;
  readonly newManagerEmploymentProfileId: string | null;
}

export interface LinkTalentEmploymentProfileCommand {
  readonly talentId: string;
  readonly linkedEmploymentProfileId: string;
}

export interface SuspendTalentCommand {
  readonly talentId: string;
}

export interface ReactivateTalentCommand {
  readonly talentId: string;
}

export interface DeactivateTalentCommand {
  readonly talentId: string;
}

export interface ArchiveTalentCommand {
  readonly talentId: string;
}

export interface UpdateTalentCommercialParticipationStatusCommand {
  readonly talentId: string;
  readonly newCommercialParticipationStatus: TalentCommercialParticipationStatus;
  readonly livestreamEligible: boolean;
  readonly eventEligible: boolean;
}

export interface GetTalentDetailQuery {
  readonly talentId: string;
}

export interface ListTalentsQuery {
  readonly operationalStatus?: TalentOperationalStatus | string;
  readonly talentOrigin?: TalentOrigin | string;
  readonly managerEmploymentProfileId?: string;
  readonly hasLinkedEmploymentProfile?: boolean | string;
  readonly commercialParticipationStatus?: TalentCommercialParticipationStatus | string;
  readonly livestreamEligible?: boolean | string;
  readonly eventEligible?: boolean | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortBy?: TalentSortField | string;
  readonly sortDirection?: TalentSortDirection | string;
}

export type TalentMutationResult = TalentMutationView;

export type GetTalentDetailResult = TalentDetailView;

export interface ListTalentsResult {
  readonly items: readonly TalentListItemView[];
  readonly nextCursor?: string;
}
