import assert from "node:assert/strict";
import test from "node:test";
import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import {
  hasFinanceGlobalAuthority,
  requireFinancePeriodAuthority,
} from "./domain/finance-scope-authority";
import {
  StructuredScopeAuthorityAssignment,
  StructuredScopeAuthorityReader,
  StructuredScopeAuthorityService,
} from "./domain/structured-scope-authority";
import { UserRoleAssignmentRecord } from "./domain/role.types";

const now = 1_000;

test("structured authority allows only permission plus matching structured scope", async () => {
  const service = serviceWith([
    record({
      permissions: ["event.read"],
      structuredScopeGrants: [
        { scopeType: "managedTalentGroup", targetId: "tg-1" },
      ],
    }),
  ]);

  assert.equal(
    await service.hasAuthority({
      userId: "user-1",
      permission: "event.read",
      scope: { scopeType: "managedTalentGroup", targetId: "tg-1" },
      now,
    }),
    true,
  );
  assert.equal(
    await service.hasAuthority({
      userId: "user-1",
      permission: "event.read",
      scope: { scopeType: "managedTalentGroup", targetId: "tg-2" },
      now,
    }),
    false,
  );
});

test("structured authority denies permission without matching scope and scope without permission", async () => {
  const service = serviceWith([
    record({ permissions: ["event.read"] }),
    record({
      permissions: ["workSchedule.read"],
      structuredScopeGrants: [
        { scopeType: "managedTalentGroup", targetId: "tg-1" },
      ],
    }),
  ]);

  assert.equal(
    await service.hasAuthority({
      userId: "user-1",
      permission: "event.read",
      scope: { scopeType: "managedTalentGroup", targetId: "tg-1" },
      now,
    }),
    false,
  );
});

test("structured authority filters future expired revoked and inactive-role assignments", async () => {
  const service = serviceWith([
    record({
      assignmentId: "future",
      permissions: ["event.read"],
      effectiveAt: now + 1,
      structuredScopeGrants: [
        { scopeType: "managedTalentGroup", targetId: "tg-1" },
      ],
    }),
    record({
      assignmentId: "expired",
      permissions: ["event.read"],
      expiresAt: now,
      structuredScopeGrants: [
        { scopeType: "managedTalentGroup", targetId: "tg-1" },
      ],
    }),
    record({
      assignmentId: "revoked",
      permissions: ["event.read"],
      state: "REVOKED",
      structuredScopeGrants: [
        { scopeType: "managedTalentGroup", targetId: "tg-1" },
      ],
    }),
    record({
      assignmentId: "inactive-role",
      permissions: ["event.read"],
      roleState: "INACTIVE",
      structuredScopeGrants: [
        { scopeType: "managedTalentGroup", targetId: "tg-1" },
      ],
    }),
  ]);

  assert.equal(
    await service.hasAuthority({
      userId: "user-1",
      permission: "event.read",
      scope: { scopeType: "managedTalentGroup", targetId: "tg-1" },
      now,
    }),
    false,
  );
});

test("bundle origin is trace metadata and does not authorize without permission and scope", async () => {
  const service = serviceWith([
    record({
      origin: "BUNDLE",
      bundleOrigin: {
        bundleAssignmentId: "bundle-1",
        bundleCode: "TALENT_GROUP_MANAGER_BUNDLE",
        bundleVersion: "2026-06-18",
      },
      permissions: [],
      structuredScopeGrants: [
        { scopeType: "managedTalentGroup", targetId: "tg-1" },
      ],
    }),
  ]);

  assert.equal(
    await service.hasAuthority({
      userId: "user-1",
      permission: "event.read",
      scope: { scopeType: "managedTalentGroup", targetId: "tg-1" },
      now,
    }),
    false,
  );
});

test("legacy compatibility mode is explicit and does not affect structured checks", async () => {
  const service = serviceWith([record({ permissions: ["event.read"] })]);
  const check = {
    userId: "user-1",
    permission: "event.read",
    scope: { scopeType: "managedTalentGroup" as const, targetId: "tg-1" },
    now,
  };

  assert.equal(await service.hasAuthority(check), false);
  assert.equal(
    await service.hasAuthority({
      ...check,
      mode: "LEGACY_PERMISSION_ONLY_COMPATIBILITY",
    }),
    true,
  );
});

test("finance authority helper allows exact financePeriod or financeGlobal only", async () => {
  const actor = actorWith([
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_APPROVE,
  ]);
  const exactPeriod = serviceWith([
    record({
      permissions: [
        Permission.REVENUE_LEDGER_PLATFORM_EARNING_APPROVE,
      ],
      structuredScopeGrants: [
        {
          scopeType: "financePeriod",
          periodKey: "2026-06",
        },
      ],
    }),
  ]);

  await requireFinancePeriodAuthority({
    actor,
    permission: Permission.REVENUE_LEDGER_PLATFORM_EARNING_APPROVE,
    periodMonth: "2026-06",
    authority: exactPeriod,
    error: new Error("denied"),
  });
  await assert.rejects(
    requireFinancePeriodAuthority({
      actor,
      permission: Permission.REVENUE_LEDGER_PLATFORM_EARNING_APPROVE,
      periodMonth: "2026-07",
      authority: exactPeriod,
      error: new Error("denied"),
    }),
    /denied/u,
  );

  const global = serviceWith([
    record({
      permissions: [
        Permission.REVENUE_LEDGER_PLATFORM_EARNING_APPROVE,
      ],
      structuredScopeGrants: [{ scopeType: "financeGlobal" }],
    }),
  ]);
  await requireFinancePeriodAuthority({
    actor,
    permission: Permission.REVENUE_LEDGER_PLATFORM_EARNING_APPROVE,
    periodMonth: "2026-07",
    authority: global,
    error: new Error("denied"),
  });
  assert.equal(
    await hasFinanceGlobalAuthority({
      actor,
      permission: Permission.REVENUE_LEDGER_PLATFORM_EARNING_APPROVE,
      authority: global,
    }),
    true,
  );
});

test("finance authority helper fails closed for malformed periodMonth", async () => {
  await assert.rejects(
    requireFinancePeriodAuthority({
      actor: actorWith([
        Permission.REVENUE_LEDGER_PLATFORM_EARNING_APPROVE,
      ]),
      permission: Permission.REVENUE_LEDGER_PLATFORM_EARNING_APPROVE,
      periodMonth: "June-2026",
      authority: serviceWith([
        record({
          permissions: [
            Permission.REVENUE_LEDGER_PLATFORM_EARNING_APPROVE,
          ],
          structuredScopeGrants: [
            { scopeType: "financeGlobal" },
          ],
        }),
      ]),
      error: new Error("denied"),
    }),
    /denied/u,
  );
});

function serviceWith(
  records: readonly StructuredScopeAuthorityAssignment[],
): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService(
    {
      async listByUserId(userId: string) {
        return records.filter((record) => record.assignment.userId === userId);
      },
    } satisfies StructuredScopeAuthorityReader,
  );
}

function actorWith(permissions: readonly Permission[]): Actor {
  return new Actor({
    id: "user-1",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions,
    scopeGrants: {},
    isActive: true,
  });
}

function record(input: {
  readonly assignmentId?: string;
  readonly userId?: string;
  readonly roleId?: string;
  readonly permissions: readonly string[];
  readonly structuredScopeGrants?: UserRoleAssignmentRecord["structuredScopeGrants"];
  readonly state?: UserRoleAssignmentRecord["state"];
  readonly roleState?: string;
  readonly effectiveAt?: number | null;
  readonly expiresAt?: number | null;
  readonly origin?: UserRoleAssignmentRecord["origin"];
  readonly bundleOrigin?: UserRoleAssignmentRecord["bundleOrigin"];
}): StructuredScopeAuthorityAssignment {
  return {
    assignment: {
      assignmentId: input.assignmentId ?? "assignment-1",
      roleId: input.roleId ?? "role-1",
      userId: input.userId ?? "user-1",
      ...(input.structuredScopeGrants
        ? { structuredScopeGrants: input.structuredScopeGrants }
        : {}),
      state: input.state ?? "ACTIVE",
      effectiveAt: input.effectiveAt ?? now - 1,
      expiresAt: input.expiresAt ?? null,
      revokedAt: input.state === "REVOKED" ? now - 1 : null,
      origin: input.origin,
      bundleOrigin: input.bundleOrigin ?? null,
      reason: null,
      createdAt: now - 1,
      updatedAt: now - 1,
    },
    role: {
      id: input.roleId ?? "role-1",
      state: input.roleState ?? "ACTIVE",
      permissions: input.permissions,
    },
  };
}
