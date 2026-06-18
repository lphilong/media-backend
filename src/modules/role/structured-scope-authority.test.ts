import assert from "node:assert/strict";
import test from "node:test";
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
