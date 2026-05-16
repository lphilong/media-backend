import { ClientSession, Db } from "mongodb";
import {
  buildGeneratedBusinessCodeRegex,
  BusinessCodePolicy,
  parseGeneratedBusinessCodeSequence,
} from "@core/business-code/business-code-sequence.repository";
import { BaseRepository } from "@infra/database/repository";
import {
  AssignTalentManagerInput,
  SetTalentLinkedEmploymentProfileInput,
  TalentRepository,
  TransitionTalentOperationalStatusInput,
  UpdateTalentCommercialParticipationInput,
  UpdateTalentCoreInput,
} from "@modules/talent/domain/talent.repository";
import {
  TalentCommercialParticipationStatus,
  TalentOperationalStatus,
  TalentOrigin,
  TalentRecord,
} from "@modules/talent/domain/talent.types";

interface TalentDocument {
  readonly _id: string;
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
  readonly linkedEmploymentProfileId: string | null;
  readonly commercialParticipationStatus: TalentCommercialParticipationStatus;
  readonly livestreamEligible: boolean;
  readonly eventEligible: boolean;
  readonly externalRef: string | null;
  readonly profileSummary: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export class NativeMongoTalentRepository
  extends BaseRepository<TalentDocument>
  implements TalentRepository
{
  constructor(db: Db) {
    super(db, "talents");
  }

  async insert(
    talent: TalentRecord,
    session: ClientSession,
  ): Promise<TalentRecord> {
    await this.collection.insertOne(
      toTalentDocument(talent),
      this.withSession(session),
    );

    return talent;
  }

  async findById(
    talentId: string,
    session?: ClientSession,
  ): Promise<TalentRecord | null> {
    const doc = await this.collection.findOne(
      { _id: talentId },
      this.withSession(session),
    );

    return doc ? toTalentRecord(doc) : null;
  }

  async findByTalentCode(
    talentCode: string,
    session?: ClientSession,
  ): Promise<TalentRecord | null> {
    const doc = await this.collection.findOne(
      { talentCode },
      this.withSession(session),
    );

    return doc ? toTalentRecord(doc) : null;
  }

  async findMaxGeneratedCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
    session?: ClientSession,
  ): Promise<number> {
    const doc = await this.collection
      .find(
        {
          talentCode:
            buildGeneratedBusinessCodeRegex(policy),
        },
        this.withSession(session),
      )
      .sort({ talentCode: -1 })
      .limit(1)
      .next();

    if (!doc) {
      return 0;
    }

    return (
      parseGeneratedBusinessCodeSequence(
        doc.talentCode,
        policy,
      ) ?? 0
    );
  }

  async findNonArchivedByLinkedEmploymentProfileId(
    linkedEmploymentProfileId: string,
    session?: ClientSession,
  ): Promise<TalentRecord | null> {
    const doc = await this.collection.findOne(
      {
        linkedEmploymentProfileId,
        operationalStatus: {
          $ne: "ARCHIVED",
        },
      },
      this.withSession(session),
    );

    return doc ? toTalentRecord(doc) : null;
  }

  async updateCore(
    input: UpdateTalentCoreInput,
    session: ClientSession,
  ): Promise<TalentRecord | null> {
    const set: Record<string, unknown> = {
      updatedAt: input.updatedAt,
    };

    if (input.stageName !== undefined) {
      set.stageName = input.stageName;
    }

    if (input.normalizedStageName !== undefined) {
      set.normalizedStageName =
        input.normalizedStageName;
    }

    if (input.legalName !== undefined) {
      set.legalName = input.legalName;
    }

    if (input.normalizedLegalName !== undefined) {
      set.normalizedLegalName =
        input.normalizedLegalName;
    }

    if (input.displayShortName !== undefined) {
      set.displayShortName =
        input.displayShortName;
    }

    if (
      input.normalizedDisplayShortName !== undefined
    ) {
      set.normalizedDisplayShortName =
        input.normalizedDisplayShortName;
    }

    if (input.externalRef !== undefined) {
      set.externalRef = input.externalRef;
    }

    if (input.profileSummary !== undefined) {
      set.profileSummary = input.profileSummary;
    }

    const updated = await this.collection.findOneAndUpdate(
      { _id: input.talentId },
      {
        $set: set,
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toTalentRecord(updated) : null;
  }

  async assignManager(
    input: AssignTalentManagerInput,
    session: ClientSession,
  ): Promise<TalentRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      { _id: input.talentId },
      {
        $set: {
          managerEmploymentProfileId:
            input.managerEmploymentProfileId,
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toTalentRecord(updated) : null;
  }

  async setLinkedEmploymentProfile(
    input: SetTalentLinkedEmploymentProfileInput,
    session: ClientSession,
  ): Promise<TalentRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      { _id: input.talentId },
      {
        $set: {
          linkedEmploymentProfileId:
            input.linkedEmploymentProfileId,
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toTalentRecord(updated) : null;
  }

  async transitionOperationalStatus(
    input: TransitionTalentOperationalStatusInput,
    session: ClientSession,
  ): Promise<TalentRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.talentId,
        operationalStatus: {
          $in: [...input.fromStatuses],
        },
      },
      {
        $set: {
          operationalStatus: input.toStatus,
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toTalentRecord(updated) : null;
  }

  async updateCommercialParticipation(
    input: UpdateTalentCommercialParticipationInput,
    session: ClientSession,
  ): Promise<TalentRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      { _id: input.talentId },
      {
        $set: {
          commercialParticipationStatus:
            input.commercialParticipationStatus,
          livestreamEligible:
            input.livestreamEligible,
          eventEligible: input.eventEligible,
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toTalentRecord(updated) : null;
  }
}

function toTalentDocument(
  talent: TalentRecord,
): TalentDocument {
  return {
    _id: talent.id,
    talentCode: talent.talentCode,
    stageName: talent.stageName,
    normalizedStageName:
      talent.normalizedStageName,
    legalName: talent.legalName,
    normalizedLegalName:
      talent.normalizedLegalName,
    displayShortName: talent.displayShortName,
    normalizedDisplayShortName:
      talent.normalizedDisplayShortName,
    talentOrigin: talent.talentOrigin,
    operationalStatus:
      talent.operationalStatus,
    managerEmploymentProfileId:
      talent.managerEmploymentProfileId,
    linkedEmploymentProfileId:
      talent.linkedEmploymentProfileId,
    commercialParticipationStatus:
      talent.commercialParticipationStatus,
    livestreamEligible:
      talent.livestreamEligible,
    eventEligible: talent.eventEligible,
    externalRef: talent.externalRef,
    profileSummary: talent.profileSummary,
    createdAt: talent.createdAt,
    updatedAt: talent.updatedAt,
  };
}

function toTalentRecord(
  document: TalentDocument,
): TalentRecord {
  return {
    id: document._id,
    talentCode: document.talentCode,
    stageName: document.stageName,
    normalizedStageName:
      document.normalizedStageName,
    legalName: document.legalName,
    normalizedLegalName:
      document.normalizedLegalName,
    displayShortName: document.displayShortName,
    normalizedDisplayShortName:
      document.normalizedDisplayShortName,
    talentOrigin: document.talentOrigin,
    operationalStatus:
      document.operationalStatus,
    managerEmploymentProfileId:
      document.managerEmploymentProfileId,
    linkedEmploymentProfileId:
      document.linkedEmploymentProfileId,
    commercialParticipationStatus:
      document.commercialParticipationStatus,
    livestreamEligible:
      document.livestreamEligible,
    eventEligible: document.eventEligible,
    externalRef: document.externalRef,
    profileSummary: document.profileSummary,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
