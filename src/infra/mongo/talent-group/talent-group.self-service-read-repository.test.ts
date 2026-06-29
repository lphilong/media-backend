import assert from "node:assert/strict";
import { test } from "node:test";
import { Actor } from "@core/actor/actor";
import { EmploymentProfileRepository } from "@modules/employment-profile/domain/employment-profile.repository";
import { TalentRepository } from "@modules/talent/domain/talent.repository";
import { SelfServiceTalentGroupsService } from "@modules/self-service/self-service.talent-groups.service";
import { SelfServiceIdentityResolver } from "@modules/self-service/shared/self-service.identity-resolver";
import { Collection, Db, Document, Filter, FindOptions, Sort } from "mongodb";
import { NativeMongoSelfServiceTalentGroupsReadRepository } from "./talent-group.self-service-read-repository";

const NOW = 50;

test("Native Mongo self-service TalentGroup repository exposes only active production-path boundaries", async () => {
  const identityResolver = new SelfServiceIdentityResolver(
    createEmploymentProfileRepository(),
    createTalentRepository(),
  );
  const service = new SelfServiceTalentGroupsService(
    identityResolver,
    new NativeMongoSelfServiceTalentGroupsReadRepository(createFakeDb()),
    () => NOW,
  );

  const result = await service.listCurrentTalentGroups(createStaffActor());
  const serialized = JSON.stringify(result);

  assert.deepEqual(result, {
    items: [
      {
        talentGroupCode: "TG-ACTIVE",
        name: "Active Group",
        status: "ACTIVE",
        managers: [
          {
            displayName: "Current Manager",
            employeeCode: "EP-MGR-ACTIVE",
          },
        ],
        members: [
          {
            talentCode: "TAL-ACTIVE",
            displayName: "Active Member",
            performanceAlias: "Active Alias",
            origin: "INTERNAL",
          },
        ],
        managersTruncated: false,
        maxManagers: 5,
        membersTruncated: false,
        maxMembers: 50,
      },
    ],
    meta: {
      groupsTruncated: false,
      maxGroups: 10,
    },
  });

  for (const forbidden of [
    "group-",
    "talent-",
    "ep-",
    "responsibility-assignment-",
    "membership-",
    "linkedEmploymentProfileId",
    "linkedUserId",
    "legalName",
    "email",
    "phone",
    "address",
    "roles",
    "scopeGrants",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

function createStaffActor(): Actor {
  return new Actor({
    id: "user-staff",
    type: "staff",
    context: "SELF_SERVICE",
    roles: ["TALENT_STAFF_SELF"],
    permissions: [],
    scopeGrants: {},
    isActive: true,
  });
}

function createEmploymentProfileRepository(): EmploymentProfileRepository {
  return {
    async findNonArchivedByLinkedUserId(linkedUserId: string) {
      assert.equal(linkedUserId, "user-staff");
      return {
        id: "ep-staff",
        employmentStatus: "ACTIVE",
      } as never;
    },
  } as unknown as EmploymentProfileRepository;
}

function createTalentRepository(): TalentRepository {
  return {
    async findNonArchivedByLinkedEmploymentProfileId(
      linkedEmploymentProfileId: string,
    ) {
      assert.equal(linkedEmploymentProfileId, "ep-staff");
      return {
        id: "talent-staff",
        linkedEmploymentProfileId: "ep-staff",
        talentOrigin: "INTERNAL",
      } as never;
    },
  } as unknown as TalentRepository;
}

function createFakeDb(): Db {
  const collections = new Map<string, readonly Document[]>([
    [
      "talent_groups",
      [
        group("group-active", "TG-ACTIVE", "Active Group", "ACTIVE"),
        group("group-inactive", "TG-INACTIVE", "Inactive Group", "INACTIVE"),
        group("group-archived", "TG-ARCHIVED", "Archived Group", "ARCHIVED"),
        group(
          "group-inactive-membership",
          "TG-INACTIVE-MEMBERSHIP",
          "Inactive Membership Group",
          "ACTIVE",
        ),
        group(
          "group-removed-membership",
          "TG-REMOVED-MEMBERSHIP",
          "Removed Membership Group",
          "ACTIVE",
        ),
        group("group-unrelated", "TG-UNRELATED", "Unrelated Group", "ACTIVE"),
      ],
    ],
    [
      "talent_group_members",
      [
        membership("membership-staff-active", "group-active", "talent-staff"),
        membership("membership-staff-inactive-group", "group-inactive", "talent-staff"),
        membership("membership-staff-archived-group", "group-archived", "talent-staff"),
        membership(
          "membership-staff-inactive",
          "group-inactive-membership",
          "talent-staff",
          "INACTIVE",
        ),
        membership(
          "membership-staff-removed",
          "group-removed-membership",
          "talent-staff",
          "REMOVED",
        ),
        membership("membership-active", "group-active", "talent-active", "ACTIVE", 1),
        membership("membership-inactive-talent", "group-active", "talent-inactive", "ACTIVE", 2),
        membership("membership-suspended-talent", "group-active", "talent-suspended", "ACTIVE", 3),
        membership("membership-archived-talent", "group-active", "talent-archived", "ACTIVE", 4),
        membership("membership-inactive-member", "group-active", "talent-inactive-member", "INACTIVE", 5),
        membership("membership-removed-member", "group-active", "talent-removed-member", "REMOVED", 6),
        membership("membership-unrelated", "group-unrelated", "talent-unrelated"),
      ],
    ],
    [
      "talents",
      [
        talent("talent-active", "TAL-ACTIVE", "ACTIVE", "ep-member-active"),
        talent("talent-inactive", "TAL-INACTIVE", "INACTIVE"),
        talent("talent-suspended", "TAL-SUSPENDED", "SUSPENDED"),
        talent("talent-archived", "TAL-ARCHIVED", "ARCHIVED"),
        talent("talent-inactive-member", "TAL-INACTIVE-MEMBER", "ACTIVE"),
        talent("talent-removed-member", "TAL-REMOVED-MEMBER", "ACTIVE"),
        talent("talent-unrelated", "TAL-UNRELATED", "ACTIVE"),
      ],
    ],
    [
      "employment_profiles",
      [
        employmentProfile("ep-member-active", "Active Member"),
        employmentProfile("ep-manager-active", "Current Manager", "ACTIVE", "EP-MGR-ACTIVE"),
        employmentProfile("ep-manager-inactive", "Inactive Manager", "INACTIVE"),
      ],
    ],
    [
      "responsibility_assignments",
      [
        responsibilityAssignment("responsibility-assignment-active", "ep-manager-active"),
        responsibilityAssignment("responsibility-assignment-inactive", "ep-manager-active", "INACTIVE"),
        responsibilityAssignment("responsibility-assignment-removed", "ep-manager-active", "REMOVED"),
        responsibilityAssignment("responsibility-assignment-expired", "ep-manager-active", "ACTIVE", 1, 49),
        responsibilityAssignment("responsibility-assignment-future", "ep-manager-active", "ACTIVE", 51),
        responsibilityAssignment("responsibility-assignment-inactive-profile", "ep-manager-inactive"),
        responsibilityAssignment("responsibility-assignment-unrelated", "ep-manager-active", "ACTIVE", 1, null, "group-unrelated"),
      ],
    ],
  ]);

  return {
    collection<TSchema extends Document = Document>(
      name: string,
    ): Collection<TSchema> {
      return createFakeCollection(collections.get(name) ?? []) as Collection<TSchema>;
    },
  } as Db;
}

function createFakeCollection<TSchema extends Document>(
  docs: readonly Document[],
): Collection<TSchema> {
  return {
    find(
      filter: Filter<TSchema>,
      options?: FindOptions<TSchema>,
    ) {
      let rows = docs
        .filter((doc) => matchesFilter(doc, filter))
        .map((doc) => applyProjection(doc, options?.projection));

      return {
        sort(sort: Sort) {
          rows = [...rows].sort((left, right) => compareDocuments(left, right, sort));
          return this;
        },
        async toArray() {
          return rows as TSchema[];
        },
      };
    },
  } as Collection<TSchema>;
}

function matchesFilter(doc: Document, filter: Document): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === "$or") {
      return (condition as readonly Document[]).some((candidate) =>
        matchesFilter(doc, candidate),
      );
    }

    const value = doc[key];

    if (!isDocument(condition)) {
      return value === condition;
    }

    return Object.entries(condition).every(([operator, expected]) => {
      if (operator === "$in") {
        return (expected as readonly unknown[]).includes(value);
      }

      if (operator === "$ne") {
        return value !== expected;
      }

      if (operator === "$lte") {
        return typeof value === "number" && value <= (expected as number);
      }

      if (operator === "$gte") {
        return typeof value === "number" && value >= (expected as number);
      }

      assert.fail(`Unsupported fake Mongo operator ${operator}`);
    });
  });
}

function applyProjection(
  doc: Document,
  projection: Document | undefined,
): Document {
  if (!projection) {
    return { ...doc };
  }

  const output: Document = { _id: doc._id };

  for (const [key, included] of Object.entries(projection)) {
    if (included && key in doc) {
      output[key] = doc[key];
    }
  }

  return output;
}

function compareDocuments(left: Document, right: Document, sort: Sort): number {
  for (const [key, direction] of Object.entries(sort)) {
    const compared = compareValues(left[key], right[key]);

    if (compared !== 0) {
      return compared * Number(direction);
    }
  }

  return 0;
}

function compareValues(left: unknown, right: unknown): number {
  if (left === right) {
    return 0;
  }

  return String(left).localeCompare(String(right));
}

function isDocument(value: unknown): value is Document {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function group(_id: string, groupCode: string, name: string, status: string): Document {
  return { _id, groupCode, name, status, displayOrder: 1 };
}

function membership(
  _id: string,
  groupId: string,
  talentId: string,
  membershipStatus = "ACTIVE",
  lineupOrder = 1,
): Document {
  return { _id, groupId, talentId, membershipStatus, lineupOrder, joinedAt: 1 };
}

function talent(
  _id: string,
  talentCode: string,
  operationalStatus: string,
  linkedEmploymentProfileId: string | null = null,
): Document {
  return {
    _id,
    talentCode,
    stageName: _id === "talent-active" ? "Active Alias" : talentCode,
    displayShortName: null,
    talentOrigin: "INTERNAL",
    linkedEmploymentProfileId,
    operationalStatus,
    legalName: "Hidden Legal Name",
    linkedUserId: "hidden-user",
  };
}

function employmentProfile(
  _id: string,
  displayName: string,
  employmentStatus = "ACTIVE",
  employeeCode = "",
): Document {
  return {
    _id,
    displayName,
    employmentStatus,
    employeeCode,
    email: "hidden@example.test",
    phone: "+84000000000",
    address: "Hidden address",
  };
}

function responsibilityAssignment(
  _id: string,
  responsibleEmploymentProfileId: string,
  status = "ACTIVE",
  effectiveAt = 1,
  expiresAt: number | null = null,
  subjectId = "group-active",
): Document {
  return {
    _id,
    subjectType: "TALENT_GROUP",
    subjectId,
    responsibleEmploymentProfileId,
    responsibilityType: "TALENT_GROUP_MANAGER",
    responsibilityRole: "MANAGER",
    status,
    effectiveAt,
    expiresAt,
    isPrimary: true,
  };
}
