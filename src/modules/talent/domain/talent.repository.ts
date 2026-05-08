import { ClientSession } from "mongodb";
import {
  TalentCommercialParticipationStatus,
  TalentOperationalStatus,
  TalentRecord,
} from "./talent.types";

export interface UpdateTalentCoreInput {
  readonly talentId: string;
  readonly stageName?: string;
  readonly normalizedStageName?: string;
  readonly legalName?: string;
  readonly normalizedLegalName?: string;
  readonly displayShortName?: string | null;
  readonly normalizedDisplayShortName?: string | null;
  readonly externalRef?: string | null;
  readonly profileSummary?: string | null;
  readonly updatedAt: number;
}

export interface AssignTalentManagerInput {
  readonly talentId: string;
  readonly managerEmploymentProfileId: string | null;
  readonly updatedAt: number;
}

export interface SetTalentLinkedEmploymentProfileInput {
  readonly talentId: string;
  readonly linkedEmploymentProfileId: string;
  readonly updatedAt: number;
}

export interface TransitionTalentOperationalStatusInput {
  readonly talentId: string;
  readonly fromStatuses: readonly TalentOperationalStatus[];
  readonly toStatus: TalentOperationalStatus;
  readonly updatedAt: number;
}

export interface UpdateTalentCommercialParticipationInput {
  readonly talentId: string;
  readonly commercialParticipationStatus: TalentCommercialParticipationStatus;
  readonly livestreamEligible: boolean;
  readonly eventEligible: boolean;
  readonly updatedAt: number;
}

export interface TalentRepository {
  insert(
    talent: TalentRecord,
    session: ClientSession,
  ): Promise<TalentRecord>;

  findById(
    talentId: string,
    session?: ClientSession,
  ): Promise<TalentRecord | null>;

  findByTalentCode(
    talentCode: string,
    session?: ClientSession,
  ): Promise<TalentRecord | null>;

  findNonArchivedByLinkedEmploymentProfileId(
    linkedEmploymentProfileId: string,
    session?: ClientSession,
  ): Promise<TalentRecord | null>;

  updateCore(
    input: UpdateTalentCoreInput,
    session: ClientSession,
  ): Promise<TalentRecord | null>;

  assignManager(
    input: AssignTalentManagerInput,
    session: ClientSession,
  ): Promise<TalentRecord | null>;

  setLinkedEmploymentProfile(
    input: SetTalentLinkedEmploymentProfileInput,
    session: ClientSession,
  ): Promise<TalentRecord | null>;

  transitionOperationalStatus(
    input: TransitionTalentOperationalStatusInput,
    session: ClientSession,
  ): Promise<TalentRecord | null>;

  updateCommercialParticipation(
    input: UpdateTalentCommercialParticipationInput,
    session: ClientSession,
  ): Promise<TalentRecord | null>;
}
