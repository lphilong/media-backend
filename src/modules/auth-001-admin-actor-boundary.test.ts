import assert from "node:assert/strict";
import { test } from "node:test";
import { Actor, ActorType } from "@core/actor/actor";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import { OrgUnitAdminQueryService } from "@modules/org-unit/admin/admin.org-unit.query-service";
import { OrgUnitAdminService } from "@modules/org-unit/admin/admin.org-unit.service";
import { EmploymentProfileAdminQueryService } from "@modules/employment-profile/admin/admin.employment-profile.query-service";
import { EmploymentProfileAdminService } from "@modules/employment-profile/admin/admin.employment-profile.service";
import { TalentAdminQueryService } from "@modules/talent/admin/admin.talent.query-service";
import { TalentAdminService } from "@modules/talent/admin/admin.talent.service";
import { TalentGroupAdminQueryService } from "@modules/talent-group/admin/admin.talent-group.query-service";
import { TalentGroupAdminService } from "@modules/talent-group/admin/admin.talent-group.service";
import { PlatformAccountAdminQueryService } from "@modules/platform-account/admin/admin.platform-account.query-service";
import { PlatformAccountAdminService } from "@modules/platform-account/admin/admin.platform-account.service";
import {
  StructuredScopeAuthorityAssignment,
  StructuredScopeAuthorityService,
} from "@modules/role/domain/structured-scope-authority";

const BRIDGE_REACHED = new Error("mutation bridge reached");

const noopLogger = {
  info(): void {},
  warn(): void {},
};

function createActor(
  type: ActorType,
  permissions: readonly string[],
): Actor {
  return new Actor({
    id: `${type}-user-1`,
    type,
    context: "ADMIN",
    accountContexts:
      type === "admin" ? ["ADMIN_CONSOLE"] : ["STAFF_CONSOLE"],
    roles: [],
    permissions,
    isActive: true,
  });
}

function structuredGlobalAuthority(
  permission: Permission,
): StructuredScopeAuthorityService {
  const record: StructuredScopeAuthorityAssignment = {
    assignment: {
      assignmentId: `assignment:${permission}`,
      roleId: `role:${permission}`,
      userId: "admin-user-1",
      structuredScopeGrants: [{ scopeType: "global" }],
      state: "ACTIVE",
      effectiveAt: 0,
      expiresAt: null,
      revokedAt: null,
      reason: null,
      createdAt: 0,
      updatedAt: 0,
    },
    role: {
      id: `role:${permission}`,
      state: "ACTIVE",
      permissions: [permission],
    },
  };
  return new StructuredScopeAuthorityService(
    {
      async listByUserId(userId: string) {
        return userId === "admin-user-1" ? [record] : [];
      },
    },
    () => 1_000,
  );
}

async function assertStaffActorDenied(
  promise: Promise<unknown>,
): Promise<void> {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof SystemInvariantError);
    assert.equal(error.code, "PERMISSION_DENIED");
    assert.match(error.message, /ADMIN_CONSOLE account context/i);
    return true;
  });
}

function createBridgeProbe(): {
  readonly bridge: { execute(): Promise<never> };
  readonly getCallCount: () => number;
} {
  let callCount = 0;

  return {
    bridge: {
      async execute(): Promise<never> {
        callCount += 1;
        throw BRIDGE_REACHED;
      },
    },
    getCallCount: () => callCount,
  };
}

async function assertAdminReachesMutationBridge(
  run: () => Promise<unknown>,
): Promise<void> {
  await bindTraceId("trace-auth-001-admin-boundary", async () => {
    await assert.rejects(run(), BRIDGE_REACHED);
  });
}

test(
  "AUTH-001 Org Unit enforces admin actor on query and mutation paths",
  async () => {
    let queryCallCount = 0;
    const queryService = new OrgUnitAdminQueryService(
      {
        listOrgUnits: async () => {
          queryCallCount += 1;
          return { items: [] };
        },
      } as never,
      structuredGlobalAuthority(Permission.ORG_UNIT_READ),
    );
    const readStaff = createActor("staff", [
      Permission.ORG_UNIT_READ,
    ]);
    const readAdmin = createActor("admin", [
      Permission.ORG_UNIT_READ,
    ]);

    await assertStaffActorDenied(
      queryService.listOrgUnits(readStaff, {}),
    );
    assert.equal(queryCallCount, 0);
    assert.deepEqual(
      await queryService.listOrgUnits(readAdmin, {}),
      { items: [] },
    );
    assert.equal(queryCallCount, 1);

    const bridgeProbe = createBridgeProbe();
    const mutationService = new OrgUnitAdminService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      bridgeProbe.bridge as never,
      undefined,
      noopLogger as never,
    );
    const mutationStaff = createActor("staff", [
      Permission.ORG_UNIT_CREATE,
    ]);
    const mutationAdmin = createActor("admin", [
      Permission.ORG_UNIT_CREATE,
    ]);
    const command = {
      code: "ORG-AUTH-001",
      name: "Auth Org",
      type: "DEPARTMENT" as const,
      displayOrder: 1,
    };

    await assertStaffActorDenied(
      mutationService.createOrgUnit(mutationStaff, command),
    );
    assert.equal(bridgeProbe.getCallCount(), 0);
    await assertAdminReachesMutationBridge(() =>
      mutationService.createOrgUnit(mutationAdmin, command),
    );
    assert.equal(bridgeProbe.getCallCount(), 1);
  },
);

test(
  "AUTH-001 Employment Profile enforces admin actor on query and mutation paths",
  async () => {
    let queryCallCount = 0;
    const queryService =
      new EmploymentProfileAdminQueryService(
        {
          listEmploymentProfiles: async () => {
            queryCallCount += 1;
            return { items: [] };
          },
        } as never,
        structuredGlobalAuthority(
          Permission.EMPLOYMENT_PROFILE_READ,
        ),
      );
    const readStaff = createActor("staff", [
      Permission.EMPLOYMENT_PROFILE_READ,
    ]);
    const readAdmin = createActor("admin", [
      Permission.EMPLOYMENT_PROFILE_READ,
    ]);

    await assertStaffActorDenied(
      queryService.listEmploymentProfiles(readStaff, {}),
    );
    assert.equal(queryCallCount, 0);
    assert.deepEqual(
      await queryService.listEmploymentProfiles(readAdmin, {}),
      { items: [] },
    );
    assert.equal(queryCallCount, 1);

    const bridgeProbe = createBridgeProbe();
    const mutationService = new EmploymentProfileAdminService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      bridgeProbe.bridge as never,
      undefined,
      noopLogger as never,
    );
    const mutationStaff = createActor("staff", [
      Permission.EMPLOYMENT_PROFILE_CREATE,
    ]);
    const mutationAdmin = createActor("admin", [
      Permission.EMPLOYMENT_PROFILE_CREATE,
    ]);
    const command = {
      employeeCode: "EMP-AUTH-001",
      legalName: "Auth Employee",
      displayName: "Auth Employee",
      employmentKind: "EMPLOYEE" as const,
      jobTitle: "Operator",
      orgUnitId: "org-1",
      contractStatus: "NONE" as const,
      employmentStartDate: "2026-01-01",
    };

    await assertStaffActorDenied(
      mutationService.createEmploymentProfile(
        mutationStaff,
        command,
      ),
    );
    assert.equal(bridgeProbe.getCallCount(), 0);
    await assertAdminReachesMutationBridge(() =>
      mutationService.createEmploymentProfile(
        mutationAdmin,
        command,
      ),
    );
    assert.equal(bridgeProbe.getCallCount(), 1);
  },
);

test(
  "AUTH-001 Talent enforces admin actor on query and mutation paths",
  async () => {
    let queryCallCount = 0;
    const queryService = new TalentAdminQueryService(
      {
        listTalents: async () => {
          queryCallCount += 1;
          return { items: [] };
        },
      } as never,
      structuredGlobalAuthority(Permission.TALENT_READ),
    );
    const readStaff = createActor("staff", [
      Permission.TALENT_READ,
    ]);
    const readAdmin = createActor("admin", [
      Permission.TALENT_READ,
    ]);

    await assertStaffActorDenied(
      queryService.listTalents(readStaff, {}),
    );
    assert.equal(queryCallCount, 0);
    assert.deepEqual(
      await queryService.listTalents(readAdmin, {}),
      { items: [] },
    );
    assert.equal(queryCallCount, 1);

    const bridgeProbe = createBridgeProbe();
    const mutationService = new TalentAdminService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      bridgeProbe.bridge as never,
      noopLogger as never,
    );
    const mutationStaff = createActor("staff", [
      Permission.TALENT_CREATE,
    ]);
    const mutationAdmin = createActor("admin", [
      Permission.TALENT_CREATE,
    ]);
    const command = {
      talentCode: "TAL-AUTH-001",
      stageName: "Auth Talent",
      legalName: "Auth Talent Legal",
      talentOrigin: "EXTERNAL" as const,
      commercialParticipationStatus: "ELIGIBLE" as const,
      livestreamEligible: true,
      eventEligible: true,
    };

    await assertStaffActorDenied(
      mutationService.createTalent(mutationStaff, command),
    );
    assert.equal(bridgeProbe.getCallCount(), 0);
    await assertAdminReachesMutationBridge(() =>
      mutationService.createTalent(mutationAdmin, command),
    );
    assert.equal(bridgeProbe.getCallCount(), 1);
  },
);

test(
  "AUTH-001 Talent Group enforces admin actor on query and mutation paths",
  async () => {
    let queryCallCount = 0;
    const queryService =
      new TalentGroupAdminQueryService(
        {
          listTalentGroups: async () => {
            queryCallCount += 1;
            return { items: [] };
          },
        } as never,
        undefined,
        structuredGlobalAuthority(Permission.TALENT_GROUP_READ),
      );
    const readStaff = createActor("staff", [
      Permission.TALENT_GROUP_READ,
    ]);
    const readAdmin = createActor("admin", [
      Permission.TALENT_GROUP_READ,
    ]);

    await assertStaffActorDenied(
      queryService.listTalentGroups(readStaff, {}),
    );
    assert.equal(queryCallCount, 0);
    assert.deepEqual(
      await queryService.listTalentGroups(readAdmin, {}),
      { items: [] },
    );
    assert.equal(queryCallCount, 1);

    const bridgeProbe = createBridgeProbe();
    const mutationService = new TalentGroupAdminService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      bridgeProbe.bridge as never,
      undefined,
      noopLogger as never,
    );
    const mutationStaff = createActor("staff", [
      Permission.TALENT_GROUP_CREATE,
    ]);
    const mutationAdmin = createActor("admin", [
      Permission.TALENT_GROUP_CREATE,
    ]);
    const command = {
      groupCode: "TG-AUTH-001",
      name: "Auth Talent Group",
      displayOrder: 1,
    };

    await assertStaffActorDenied(
      mutationService.createTalentGroup(
        mutationStaff,
        command,
      ),
    );
    assert.equal(bridgeProbe.getCallCount(), 0);
    await assertAdminReachesMutationBridge(() =>
      mutationService.createTalentGroup(
        mutationAdmin,
        command,
      ),
    );
    assert.equal(bridgeProbe.getCallCount(), 1);
  },
);

test(
  "AUTH-001 Platform Account enforces admin actor on query and mutation paths",
  async () => {
    let queryCallCount = 0;
    const queryService =
      new PlatformAccountAdminQueryService(
        {
          listPlatformAccounts: async () => {
            queryCallCount += 1;
            return { items: [] };
          },
        } as never,
        structuredGlobalAuthority(
          Permission.PLATFORM_ACCOUNT_READ,
        ),
      );
    const readStaff = createActor("staff", [
      Permission.PLATFORM_ACCOUNT_READ,
    ]);
    const readAdmin = createActor("admin", [
      Permission.PLATFORM_ACCOUNT_READ,
    ]);

    await assertStaffActorDenied(
      queryService.listPlatformAccounts(readStaff, {}),
    );
    assert.equal(queryCallCount, 0);
    assert.deepEqual(
      await queryService.listPlatformAccounts(readAdmin, {}),
      { items: [] },
    );
    assert.equal(queryCallCount, 1);

    const bridgeProbe = createBridgeProbe();
    const mutationService =
      new PlatformAccountAdminService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        bridgeProbe.bridge as never,
        noopLogger as never,
      );
    const mutationStaff = createActor("staff", [
      Permission.PLATFORM_ACCOUNT_CREATE,
    ]);
    const mutationAdmin = createActor("admin", [
      Permission.PLATFORM_ACCOUNT_CREATE,
    ]);
    const command = {
      accountCode: "PA-AUTH-001",
      platform: "TIKTOK" as const,
      platformSurfaceType: "ACCOUNT" as const,
      displayName: "Auth Platform",
      handle: "auth-platform",
      ownerKind: "ORG_UNIT" as const,
      ownerOrgUnitId: "org-1",
      livestreamEnabled: true,
      contentPublishingEnabled: true,
      monetizationEnabled: false,
    };

    await assertStaffActorDenied(
      mutationService.createPlatformAccount(
        mutationStaff,
        command,
      ),
    );
    assert.equal(bridgeProbe.getCallCount(), 0);
    await assertAdminReachesMutationBridge(() =>
      mutationService.createPlatformAccount(
        mutationAdmin,
        command,
      ),
    );
    assert.equal(bridgeProbe.getCallCount(), 1);
  },
);

test(
  "AUTH-001 legacy admin actor and permission do not bypass structured-required query authority",
  async () => {
    let queryCallCount = 0;
    const queryService = new TalentAdminQueryService(
      {
        async listTalents() {
          queryCallCount += 1;
          return { items: [] };
        },
      } as never,
      new StructuredScopeAuthorityService({
        async listByUserId() {
          return [];
        },
      }),
    );

    await assert.rejects(
      queryService.listTalents(
        createActor("admin", [Permission.TALENT_READ]),
        {},
      ),
      (error) => {
        assert.ok(error instanceof SystemInvariantError);
        assert.equal(error.code, "PERMISSION_DENIED");
        return true;
      },
    );
    assert.equal(queryCallCount, 0);
  },
);
