import {
  ClientSession,
  Collection,
  Db,
} from "mongodb";
import {
  ContractRegistryEmploymentProfileReadonlyAccess,
  ContractRegistryReferencedEmploymentProfile,
} from "@modules/contract-registry/domain/contract-registry-employment-profile-readonly-access";
import {
  ContractRegistryReferencedTalent,
  ContractRegistryTalentReadonlyAccess,
} from "@modules/contract-registry/domain/contract-registry-talent-readonly-access";
import { EmploymentStatus } from "@modules/employment-profile/domain/employment-profile.types";
import { TalentOperationalStatus } from "@modules/talent/domain/talent.types";

interface EmploymentProfileReferenceDocument {
  readonly _id: string;
  readonly employmentStatus: EmploymentStatus;
}

interface TalentReferenceDocument {
  readonly _id: string;
  readonly operationalStatus: TalentOperationalStatus;
}

export class NativeMongoContractRegistryEmploymentProfileReadonlyAccess
  implements ContractRegistryEmploymentProfileReadonlyAccess
{
  private readonly employmentProfileCollection: Collection<EmploymentProfileReferenceDocument>;

  constructor(db: Db) {
    this.employmentProfileCollection =
      db.collection<EmploymentProfileReferenceDocument>(
        "employment_profiles",
      );
  }

  async findById(
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<ContractRegistryReferencedEmploymentProfile | null> {
    const document =
      await this.employmentProfileCollection.findOne(
        {
          _id: employmentProfileId,
        },
        {
          projection: {
            _id: 1,
            employmentStatus: 1,
          },
          ...(session ? { session } : {}),
        },
      );

    return document
      ? {
          id: document._id,
          employmentStatus:
            document.employmentStatus,
        }
      : null;
  }
}

export class NativeMongoContractRegistryTalentReadonlyAccess
  implements ContractRegistryTalentReadonlyAccess
{
  private readonly talentCollection: Collection<TalentReferenceDocument>;

  constructor(db: Db) {
    this.talentCollection =
      db.collection<TalentReferenceDocument>(
        "talents",
      );
  }

  async findById(
    talentId: string,
    session?: ClientSession,
  ): Promise<ContractRegistryReferencedTalent | null> {
    const document =
      await this.talentCollection.findOne(
        {
          _id: talentId,
        },
        {
          projection: {
            _id: 1,
            operationalStatus: 1,
          },
          ...(session ? { session } : {}),
        },
      );

    return document
      ? {
          id: document._id,
          operationalStatus:
            document.operationalStatus,
        }
      : null;
  }
}
