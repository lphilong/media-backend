import { ReferenceSummary } from "@modules/reference-summary";

export const TALENT_ORIGINS = [
  "INTERNAL",
  "EXTERNAL",
] as const;

export type TalentOrigin =
  (typeof TALENT_ORIGINS)[number];

export const TALENT_OPERATIONAL_STATUSES = [
  "ACTIVE",
  "SUSPENDED",
  "INACTIVE",
  "ARCHIVED",
] as const;

export type TalentOperationalStatus =
  (typeof TALENT_OPERATIONAL_STATUSES)[number];

export const TALENT_COMMERCIAL_PARTICIPATION_STATUSES = [
  "ELIGIBLE",
  "RESTRICTED",
  "BLOCKED",
] as const;

export type TalentCommercialParticipationStatus =
  (typeof TALENT_COMMERCIAL_PARTICIPATION_STATUSES)[number];

export const TALENT_SORT_FIELDS = [
  "talentCode",
  "stageName",
  "legalName",
  "createdAt",
] as const;

export type TalentSortField =
  (typeof TALENT_SORT_FIELDS)[number];

export const TALENT_SORT_DIRECTIONS = [
  "ASC",
  "DESC",
] as const;

export type TalentSortDirection =
  (typeof TALENT_SORT_DIRECTIONS)[number];

export interface TalentRecord {
  readonly id: string;
  readonly talentCode: string;
  readonly stageName: string;
  readonly normalizedStageName: string;
  readonly legalName: string;
  readonly normalizedLegalName: string;
  readonly displayShortName: string | null;
  readonly normalizedDisplayShortName: string | null;
  readonly talentOrigin: TalentOrigin;
  readonly operationalStatus: TalentOperationalStatus;
  readonly managerEmploymentProfileId: string | null;
  readonly managerEmploymentProfileRef?: ReferenceSummary | null;
  readonly linkedEmploymentProfileId: string | null;
  readonly linkedEmploymentProfileRef?: ReferenceSummary | null;
  readonly commercialParticipationStatus: TalentCommercialParticipationStatus;
  readonly livestreamEligible: boolean;
  readonly eventEligible: boolean;
  readonly externalRef: string | null;
  readonly profileSummary: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface TalentListItemView {
  readonly id: string;
  readonly talentCode: string;
  readonly displayName: string;
  readonly performanceAlias: string | null;
  readonly stageName: string;
  readonly legalName: string;
  readonly displayShortName: string | null;
  readonly talentOrigin: TalentOrigin;
  readonly operationalStatus: TalentOperationalStatus;
  readonly managerEmploymentProfileId: string | null;
  readonly managerEmploymentProfileRef?: ReferenceSummary | null;
  readonly linkedEmploymentProfileId: string | null;
  readonly linkedEmploymentProfileRef?: ReferenceSummary | null;
  readonly commercialParticipationStatus: TalentCommercialParticipationStatus;
  readonly livestreamEligible: boolean;
  readonly eventEligible: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface TalentManagerListItemView
  extends TalentListItemView {}

export interface TalentEmploymentLinkListItemView
  extends TalentListItemView {}

export interface TalentDetailView
  extends TalentListItemView {
  readonly externalRef: string | null;
  readonly profileSummary: string | null;
}

export interface TalentMutationView
  extends TalentDetailView {}
