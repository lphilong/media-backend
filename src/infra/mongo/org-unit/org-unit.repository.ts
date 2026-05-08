import { ClientSession, Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository";
import {
  FindLiveSiblingByNormalizedNameInput,
  OrgUnitRepository,
  RewriteOrgUnitHierarchyInput,
  TransitionOrgUnitStatusInput,
  UpdateOrgUnitProfileInput,
} from "@modules/org-unit/domain/org-unit.repository";
import {
  OrgUnitRecord,
  OrgUnitStatus,
  OrgUnitType,
} from "@modules/org-unit/domain/org-unit.types";

interface OrgUnitDocument {
  readonly _id: string;
  readonly code: string;
  readonly searchCode: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly type: OrgUnitType;
  readonly status: OrgUnitStatus;
  readonly parentOrgUnitId: string | null;
  readonly ancestorChain: readonly string[];
  readonly depth: number;
  readonly displayOrder: number;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export class NativeMongoOrgUnitRepository
  extends BaseRepository<OrgUnitDocument>
  implements OrgUnitRepository
{
  constructor(db: Db) {
    super(db, "org_units");
  }

  async insert(
    orgUnit: OrgUnitRecord,
    session: ClientSession,
  ): Promise<OrgUnitRecord> {
    await this.collection.insertOne(
      toOrgUnitDocument(orgUnit),
      this.withSession(session),
    );

    return orgUnit;
  }

  async findById(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<OrgUnitRecord | null> {
    const doc = await this.collection.findOne(
      { _id: orgUnitId },
      this.withSession(session),
    );

    return doc ? toOrgUnitRecord(doc) : null;
  }

  async findByCode(
    code: string,
    session?: ClientSession,
  ): Promise<OrgUnitRecord | null> {
    const doc = await this.collection.findOne(
      { code },
      this.withSession(session),
    );

    return doc ? toOrgUnitRecord(doc) : null;
  }

  async findLiveSiblingByNormalizedName(
    input: FindLiveSiblingByNormalizedNameInput,
    session?: ClientSession,
  ): Promise<OrgUnitRecord | null> {
    const filter: Record<string, unknown> = {
      parentOrgUnitId: input.parentOrgUnitId,
      normalizedName: input.normalizedName,
      status: {
        $ne: "ARCHIVED",
      },
    };

    if (input.excludeOrgUnitId) {
      filter._id = {
        $ne: input.excludeOrgUnitId,
      };
    }

    const doc = await this.collection.findOne(
      filter,
      this.withSession(session),
    );

    return doc ? toOrgUnitRecord(doc) : null;
  }

  async updateProfile(
    input: UpdateOrgUnitProfileInput,
    session: ClientSession,
  ): Promise<OrgUnitRecord | null> {
    const set: Record<string, unknown> = {
      updatedAt: input.updatedAt,
    };

    if (input.name !== undefined) {
      set.name = input.name;
    }

    if (input.normalizedName !== undefined) {
      set.normalizedName = input.normalizedName;
    }

    if (input.description !== undefined) {
      set.description = input.description;
    }

    if (input.displayOrder !== undefined) {
      set.displayOrder = input.displayOrder;
    }

    if (input.externalRef !== undefined) {
      set.externalRef = input.externalRef;
    }

    const updated = await this.collection.findOneAndUpdate(
      { _id: input.orgUnitId },
      {
        $set: set,
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toOrgUnitRecord(updated) : null;
  }

  async rewriteHierarchy(
    input: RewriteOrgUnitHierarchyInput,
    session: ClientSession,
  ): Promise<OrgUnitRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      { _id: input.orgUnitId },
      {
        $set: {
          parentOrgUnitId: input.parentOrgUnitId,
          ancestorChain: [...input.ancestorChain],
          depth: input.depth,
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    if (!updated) {
      return null;
    }

    if (input.descendants.length > 0) {
      await this.collection.bulkWrite(
        input.descendants.map((descendant) => ({
          updateOne: {
            filter: { _id: descendant.orgUnitId },
            update: {
              $set: {
                ancestorChain: [
                  ...descendant.ancestorChain,
                ],
                depth: descendant.depth,
                updatedAt: descendant.updatedAt,
              },
            },
          },
        })),
        {
          ...this.withSession(session),
          ordered: true,
        },
      );
    }

    return toOrgUnitRecord(updated);
  }

  async transitionStatus(
    input: TransitionOrgUnitStatusInput,
    session: ClientSession,
  ): Promise<OrgUnitRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.orgUnitId,
        status: {
          $in: [...input.fromStatuses],
        },
      },
      {
        $set: {
          status: input.toStatus,
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toOrgUnitRecord(updated) : null;
  }

  async listDescendants(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<readonly OrgUnitRecord[]> {
    const docs = await this.collection
      .find(
        {
          ancestorChain: orgUnitId,
        },
        this.withSession(session),
      )
      .sort({ depth: 1, _id: 1 })
      .toArray();

    return docs.map((doc) => toOrgUnitRecord(doc));
  }

  async hasDescendantWithStatuses(
    orgUnitId: string,
    statuses: readonly OrgUnitStatus[],
    session?: ClientSession,
  ): Promise<boolean> {
    const doc = await this.collection.findOne(
      {
        ancestorChain: orgUnitId,
        status: {
          $in: [...statuses],
        },
      },
      {
        ...this.withSession(session),
        projection: { _id: 1 },
      },
    );

    return doc !== null;
  }

  async hasNonArchivedDescendants(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    const doc = await this.collection.findOne(
      {
        ancestorChain: orgUnitId,
        status: {
          $ne: "ARCHIVED",
        },
      },
      {
        ...this.withSession(session),
        projection: { _id: 1 },
      },
    );

    return doc !== null;
  }
}

function toOrgUnitDocument(
  orgUnit: OrgUnitRecord,
): OrgUnitDocument {
  return {
    _id: orgUnit.id,
    code: orgUnit.code,
    searchCode: orgUnit.searchCode,
    name: orgUnit.name,
    normalizedName: orgUnit.normalizedName,
    type: orgUnit.type,
    status: orgUnit.status,
    parentOrgUnitId: orgUnit.parentOrgUnitId,
    ancestorChain: [...orgUnit.ancestorChain],
    depth: orgUnit.depth,
    displayOrder: orgUnit.displayOrder,
    description: orgUnit.description,
    externalRef: orgUnit.externalRef,
    createdAt: orgUnit.createdAt,
    updatedAt: orgUnit.updatedAt,
  };
}

function toOrgUnitRecord(
  document: OrgUnitDocument,
): OrgUnitRecord {
  return {
    id: document._id,
    code: document.code,
    searchCode: document.searchCode,
    name: document.name,
    normalizedName: document.normalizedName,
    type: document.type,
    status: document.status,
    parentOrgUnitId: document.parentOrgUnitId,
    ancestorChain: [...document.ancestorChain],
    depth: document.depth,
    displayOrder: document.displayOrder,
    description: document.description,
    externalRef: document.externalRef,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
