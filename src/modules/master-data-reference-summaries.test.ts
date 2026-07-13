import assert from "node:assert/strict";
import { test } from "node:test";
import { NativeMongoEmploymentProfileReadRepository } from "@infra/mongo/employment-profile/employment-profile.read-repository";
import { NativeMongoOrgUnitReadRepository } from "@infra/mongo/org-unit/org-unit.read-repository";
import { NativeMongoPlatformAccountReadRepository } from "@infra/mongo/platform-account/platform-account.read-repository";
import { NativeMongoReferenceLookupReadRepository } from "@infra/mongo/reference-lookup/reference-lookup.read-repository";
import { NativeMongoTalentGroupReadRepository } from "@infra/mongo/talent-group/talent-group.read-repository";
import { NativeMongoTalentReadRepository } from "@infra/mongo/talent/talent.read-repository";
import { EmploymentProfileAdminDetailExposure } from "@modules/employment-profile/shared/employment-profile.exposure";
import { OrgUnitAdminListExposure } from "@modules/org-unit/shared/org-unit.exposure";
import { PlatformAccountAdminListExposure } from "@modules/platform-account/shared/platform-account.exposure";
import { TalentGroupMemberExposure } from "@modules/talent-group/shared/talent-group.exposure";
import { TalentAdminDetailExposure } from "@modules/talent/shared/talent.exposure";

type FindCall = {
  readonly collection: string;
  readonly query: unknown;
  readonly options: unknown;
};

const orgRoot = {
  _id: "ou-root",
  code: "OU-1",
  searchCode: "ou-1",
  name: "Head Office",
  normalizedName: "head office",
  type: "DEPARTMENT",
  status: "ACTIVE",
  parentOrgUnitId: null,
  ancestorChain: [],
  depth: 0,
  displayOrder: 1,
  description: null,
  externalRef: null,
  createdAt: 1,
  updatedAt: 2,
};

const orgChild = {
  ...orgRoot,
  _id: "ou-child",
  code: "OU-2",
  searchCode: "ou-2",
  name: "Sales",
  normalizedName: "sales",
  parentOrgUnitId: "ou-root",
  ancestorChain: ["ou-root"],
  depth: 1,
  displayOrder: 2,
};

const epManager = {
  _id: "ep-manager",
  employeeCode: "EP-1",
  legalName: "Alice Legal",
  normalizedLegalName: "alice legal",
  displayName: "Alice",
  normalizedDisplayName: "alice",
  employmentKind: "EMPLOYEE",
  jobTitle: "Manager",
  titleDescription: null,
  externalRef: null,
  orgUnitId: "ou-root",
  managerEmploymentProfileId: null,
  recruiterEmploymentProfileId: null,
  hrOwnerEmploymentProfileId: null,
  onboardingOwnerEmploymentProfileId: null,
  sourcedByEmploymentProfileId: null,
  linkedUserId: "user-1",
  employmentStatus: "ACTIVE",
  contractStatus: "ACTIVE",
  employmentStartDate: 1_704_067_200_000,
  employmentEndDate: null,
  hiredAt: null,
  onboardedAt: null,
  createdAt: 1,
  updatedAt: 2,
};

const epChild = {
  ...epManager,
  _id: "ep-child",
  employeeCode: "EP-2",
  legalName: "Bao Legal",
  normalizedLegalName: "bao legal",
  displayName: "Bao",
  normalizedDisplayName: "bao",
  orgUnitId: "ou-child",
  managerEmploymentProfileId: "ep-manager",
  recruiterEmploymentProfileId: "ep-manager",
  hrOwnerEmploymentProfileId: "ep-manager",
  onboardingOwnerEmploymentProfileId: "ep-manager",
  sourcedByEmploymentProfileId: null,
  linkedUserId: "missing-user",
};

const talent = {
  _id: "talent-1",
  talentCode: "TAL-1",
  stageName: "Mina Performance Alias",
  normalizedStageName: "mina performance alias",
  legalName: "Stale Internal Talent Legal",
  normalizedLegalName: "stale internal talent legal",
  displayShortName: "Stale Internal Talent Short",
  normalizedDisplayShortName: "stale internal talent short",
  talentOrigin: "INTERNAL",
  operationalStatus: "ACTIVE",
  managerEmploymentProfileId: "ep-manager",
  linkedEmploymentProfileId: "ep-child",
  commercialParticipationStatus: "ELIGIBLE",
  livestreamEligible: true,
  eventEligible: true,
  externalRef: null,
  profileSummary: null,
  createdAt: 1,
  updatedAt: 2,
};

const talentGroup = {
  _id: "group-1",
  groupCode: "TG-1",
  name: "A Team",
  normalizedName: "a team",
  shortName: null,
  normalizedShortName: null,
  description: null,
  externalRef: null,
  status: "ACTIVE",
  displayOrder: 1,
  createdAt: 1,
  updatedAt: 2,
};

const membership = {
  _id: "membership-1",
  groupId: "group-1",
  talentId: "talent-1",
  membershipStatus: "ACTIVE",
  lineupOrder: 1,
  joinedAt: 1,
  leftAt: null,
  createdAt: 1,
  updatedAt: 2,
};

const externalTalent = {
  ...talent,
  _id: "talent-external",
  talentCode: "TAL-2",
  stageName: "BaoStar",
  normalizedStageName: "baostar",
  legalName: "Bao External Legal",
  normalizedLegalName: "bao external legal",
  displayShortName: null,
  normalizedDisplayShortName: null,
  talentOrigin: "EXTERNAL",
  linkedEmploymentProfileId: null,
};

const externalMembership = {
  ...membership,
  _id: "membership-external",
  talentId: "talent-external",
  lineupOrder: 2,
};

const platformAccounts = [
  {
    _id: "platform-org",
    accountCode: "PA-1",
    platform: "YOUTUBE",
    platformSurfaceType: "ACCOUNT",
    displayName: "Org Channel",
    normalizedDisplayName: "org channel",
    handle: null,
    normalizedHandle: null,
    externalPlatformId: null,
    profileUrl: null,
    normalizedProfileUrl: null,
    ownerKind: "ORG_UNIT",
    ownerOrgUnitId: "ou-root",
    ownerTalentId: null,
    ownerTalentGroupId: null,
    operationalStatus: "ACTIVE",
    livestreamEnabled: true,
    contentPublishingEnabled: true,
    monetizationEnabled: false,
    description: null,
    externalRef: null,
    createdAt: 1,
    updatedAt: 2,
  },
  {
    _id: "platform-talent",
    accountCode: "PA-2",
    platform: "TIKTOK",
    platformSurfaceType: "ACCOUNT",
    displayName: "Talent Channel",
    normalizedDisplayName: "talent channel",
    handle: "@talent",
    normalizedHandle: "talent",
    externalPlatformId: null,
    profileUrl: null,
    normalizedProfileUrl: null,
    ownerKind: "TALENT",
    ownerOrgUnitId: null,
    ownerTalentId: "talent-1",
    ownerTalentGroupId: null,
    operationalStatus: "ACTIVE",
    livestreamEnabled: true,
    contentPublishingEnabled: true,
    monetizationEnabled: false,
    description: null,
    externalRef: null,
    createdAt: 2,
    updatedAt: 3,
  },
  {
    _id: "platform-group",
    accountCode: "PA-3",
    platform: "INSTAGRAM",
    platformSurfaceType: "ACCOUNT",
    displayName: "Group Channel",
    normalizedDisplayName: "group channel",
    handle: null,
    normalizedHandle: null,
    externalPlatformId: null,
    profileUrl: null,
    normalizedProfileUrl: null,
    ownerKind: "TALENT_GROUP",
    ownerOrgUnitId: null,
    ownerTalentId: null,
    ownerTalentGroupId: "group-1",
    operationalStatus: "ACTIVE",
    livestreamEnabled: true,
    contentPublishingEnabled: true,
    monetizationEnabled: false,
    description: null,
    externalRef: null,
    createdAt: 3,
    updatedAt: 4,
  },
];

function createFindResult(documents: readonly unknown[]) {
  return {
    sort() {
      return {
        limit() {
          return {
            toArray: async () => [...documents],
          };
        },
      };
    },
    limit() {
      return {
        toArray: async () => [...documents],
      };
    },
    toArray: async () => [...documents],
  };
}

test("master-data Org Unit parent refs enrich list/detail without dropping raw IDs", async () => {
  const calls: FindCall[] = [];
  const repository = new NativeMongoOrgUnitReadRepository({
    collection(name: string) {
      return {
        find(query: unknown, options: unknown) {
          calls.push({ collection: name, query, options });
          return createFindResult(options ? [orgRoot] : [orgChild]);
        },
        findOne: async () => orgChild,
      };
    },
  } as never);

  const list = await repository.listOrgUnits({ limit: 10 });
  const detail = await repository.getOrgUnitDetail("ou-child");

  assert.equal(list.items[0].parentOrgUnitId, "ou-root");
  assert.deepEqual(list.items[0].parentOrgUnitRef, {
    id: "ou-root",
    code: "OU-1",
    name: "Head Office",
    status: "ACTIVE",
  });
  assert.equal(detail?.parentOrgUnitId, "ou-root");
  assert.deepEqual(detail?.parentOrgUnitRef, list.items[0].parentOrgUnitRef);
  assert.equal(
    OrgUnitAdminListExposure.expose(list.items[0]).parentOrgUnitRef !==
      undefined,
    true,
  );
  assert.deepEqual(calls[1].options, {
    projection: { _id: 1, code: 1, name: 1, status: 1 },
  });
});

test("master-data Employment Profile refs enrich org, attribution, and linked user safely", async () => {
  const calls: FindCall[] = [];
  const repository = new NativeMongoEmploymentProfileReadRepository({
    collection(name: string) {
      return {
        find(query: unknown, options: unknown) {
          calls.push({ collection: name, query, options });
          if (name === "org_units") return createFindResult([orgChild]);
          if (name === "users") return createFindResult([]);
          if (options) return createFindResult([epManager]);
          return createFindResult([epChild]);
        },
        findOne: async () => epChild,
      };
    },
  } as never);

  const list = await repository.listEmploymentProfiles({ limit: 10 });
  const detail = await repository.getEmploymentProfileDetail("ep-child");

  assert.equal(list.items[0].orgUnitId, "ou-child");
  assert.deepEqual(list.items[0].orgUnitRef, {
    id: "ou-child",
    code: "OU-2",
    name: "Sales",
    status: "ACTIVE",
  });
  assert.deepEqual(list.items[0].recruiterEmploymentProfileRef, {
    id: "ep-manager",
    code: "EP-1",
    displayName: "Alice",
    name: "Alice Legal",
    status: "ACTIVE",
  });
  assert.equal(list.items[0].recruiterEmploymentProfileId, "ep-manager");
  assert.equal(
    list.items[0].recruiterEmploymentProfileRef?.displayName,
    "Alice",
  );
  assert.notEqual(
    list.items[0].recruiterEmploymentProfileRef?.displayName,
    "Alice Legal",
  );
  assert.deepEqual(
    detail?.hrOwnerEmploymentProfileRef,
    list.items[0].recruiterEmploymentProfileRef,
  );
  assert.deepEqual(
    detail?.onboardingOwnerEmploymentProfileRef,
    list.items[0].recruiterEmploymentProfileRef,
  );
  assert.equal(detail?.sourcedByEmploymentProfileRef, null);
  assert.equal(list.items[0].linkedUserId, "missing-user");
  assert.equal(list.items[0].linkedUserRef, null);
  assert.equal(
    EmploymentProfileAdminDetailExposure.expose(detail!).linkedUserRef !==
      undefined,
    true,
  );
  assert.equal(
    calls.filter((call) => call.collection === "org_units").length,
    2,
  );
  assert.equal(calls.filter((call) => call.collection === "users").length, 2);
});

test("master-data Talent refs enrich linked employment profile in one batch", async () => {
  const calls: FindCall[] = [];
  const repository = new NativeMongoTalentReadRepository({
    collection(name: string) {
      return {
        find(query: unknown, options: unknown) {
          calls.push({ collection: name, query, options });
          return createFindResult(options ? [epManager, epChild] : [talent]);
        },
        findOne: async () => talent,
      };
    },
  } as never);

  const list = await repository.listTalents({ limit: 10 });
  const detail = await repository.getTalentDetail("talent-1");

  assert.equal(list.items[0].linkedEmploymentProfileId, "ep-child");
  assert.equal(list.items[0].linkedEmploymentProfileRef?.code, "EP-2");
  assert.equal(list.items[0].displayName, "Bao");
  assert.equal(list.items[0].performanceAlias, "Mina Performance Alias");
  assert.notEqual(list.items[0].displayName, talent.legalName);
  assert.notEqual(list.items[0].displayName, talent.displayShortName);
  assert.equal(detail?.displayName, "Bao");
  assert.deepEqual(
    detail?.linkedEmploymentProfileRef,
    list.items[0].linkedEmploymentProfileRef,
  );
  assert.equal(
    TalentAdminDetailExposure.expose(detail!).linkedEmploymentProfileRef !==
      undefined,
    true,
  );
  assert.deepEqual(calls[1].options, {
    projection: {
      _id: 1,
      employeeCode: 1,
      legalName: 1,
      displayName: 1,
      employmentStatus: 1,
    },
  });
});

test("master-data Talent Group member refs preserve membership IDs and member order", async () => {
  const repository = new NativeMongoTalentGroupReadRepository({
    collection(name: string) {
      if (name === "talent_group_members") {
        return {
          find(query: { readonly talentId?: string }) {
            return createFindResult(
              query.talentId === "talent-1"
                ? [membership]
                : [membership, externalMembership],
            );
          },
          distinct: async () => ["group-1"],
        };
      }
      if (name === "employment_profiles") {
        return {
          find() {
            return createFindResult([epChild]);
          },
        };
      }
      return {
        find(_query: unknown, options: unknown) {
          return createFindResult(
            options ? [talent, externalTalent] : [talentGroup],
          );
        },
        findOne: async () => talentGroup,
      };
    },
  } as never);

  const members = await repository.listTalentGroupMembers({
    groupId: "group-1",
    limit: 10,
  });
  const byTalent = await repository.listTalentGroupsByTalent({
    talentId: "talent-1",
    limit: 10,
  });

  const internalMember = members.items.find(
    (item) => item.id === "membership-1",
  );
  const externalMember = members.items.find(
    (item) => item.id === "membership-external",
  );

  assert.equal(internalMember?.talentId, "talent-1");
  assert.deepEqual(internalMember?.talentRef, {
    id: "talent-1",
    code: "TAL-1",
    name: "Bao",
    displayName: "Bao",
    status: "ACTIVE",
  });
  assert.deepEqual(externalMember?.talentRef, {
    id: "talent-external",
    code: "TAL-2",
    name: "BaoStar",
    displayName: "BaoStar",
    status: "ACTIVE",
  });
  const internalByTalent = byTalent.items.find(
    (item) => item.membershipId === "membership-1",
  );

  assert.deepEqual(internalByTalent?.talentRef, internalMember?.talentRef);
  assert.equal(
    TalentGroupMemberExposure.expose(members.items[0]).talentRef !== undefined,
    true,
  );
});

test("reference lookup Talent labels derive internal names from Employment Profile", async () => {
  const repository = new NativeMongoReferenceLookupReadRepository({
    collection(name: string) {
      if (name === "employment_profiles") {
        return {
          find() {
            return createFindResult([epChild]);
          },
        };
      }

      return {
        find() {
          return createFindResult([talent, externalTalent]);
        },
      };
    },
  } as never);

  const options = await repository.listReferenceOptions({
    domain: "talents",
    limit: 10,
  });

  assert.deepEqual(options[0], {
    id: "talent-1",
    label: "Bao",
    secondaryLabel: "Mina Performance Alias",
    code: "TAL-1",
    status: "ACTIVE",
  });
  assert.deepEqual(options[1], {
    id: "talent-external",
    label: "BaoStar",
    secondaryLabel: "Bao External Legal",
    code: "TAL-2",
    status: "ACTIVE",
  });
});

test("reference lookup Employment Profile labels default to displayName", async () => {
  const repository = new NativeMongoReferenceLookupReadRepository({
    collection() {
      return {
        find() {
          return createFindResult([epChild]);
        },
      };
    },
  } as never);

  const options = await repository.listReferenceOptions({
    domain: "employmentProfiles",
    limit: 10,
  });

  assert.equal(options[0].label, "Bao");
  assert.notEqual(options[0].label, "Bao Legal");
  assert.equal(options[0].secondaryLabel, "Manager");
});

test("master-data Platform Account ownerRef follows ownerKind polymorphism and preserves owner IDs", async () => {
  const calls: FindCall[] = [];
  const repository = new NativeMongoPlatformAccountReadRepository({
    collection(name: string) {
      return {
        find(query: unknown, options: unknown) {
          calls.push({ collection: name, query, options });
          if (name === "org_units") return createFindResult([orgRoot]);
          if (name === "talents") return createFindResult([talent]);
          if (name === "talent_groups") return createFindResult([talentGroup]);
          return createFindResult(platformAccounts);
        },
        findOne: async () => platformAccounts[1],
      };
    },
  } as never);

  const list = await repository.listPlatformAccounts({ limit: 10 });
  const detail = await repository.getPlatformAccountDetail("platform-talent");

  assert.equal(list.items[0].ownerOrgUnitId, "ou-root");
  assert.equal(list.items[1].ownerTalentId, "talent-1");
  assert.equal(list.items[2].ownerTalentGroupId, "group-1");
  assert.equal(list.items[0].ownerRef?.code, "OU-1");
  assert.equal(list.items[1].ownerRef?.code, "TAL-1");
  assert.equal(list.items[2].ownerRef?.code, "TG-1");
  assert.equal(detail?.ownerKind, "TALENT");
  assert.equal(detail?.ownerRef?.code, "TAL-1");
  assert.equal(
    PlatformAccountAdminListExposure.expose(list.items[0]).ownerRef !==
      undefined,
    true,
  );
  assert.equal(
    calls.filter((call) => call.collection === "org_units").length,
    1,
  );
  assert.equal(calls.filter((call) => call.collection === "talents").length, 2);
  assert.equal(
    calls.filter((call) => call.collection === "talent_groups").length,
    1,
  );
});
