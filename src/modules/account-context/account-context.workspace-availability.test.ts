import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWorkspaceAvailability } from "./account-context.workspace-availability";

test("workspace availability allows each account context from ACCOUNT_CONTEXT source", () => {
  for (const context of [
    "ADMIN_CONSOLE",
    "MANAGER_CONSOLE",
    "STAFF_CONSOLE",
  ] as const) {
    const availability = buildWorkspaceAvailability({
      accountContexts: [context],
      legacyActorKind: context === "ADMIN_CONSOLE" ? "STAFF" : "ADMIN",
    });

    assert.equal(availability.primaryWorkspace, context);
    assert.deepEqual(
      availability.availableWorkspaces
        .filter((workspace) => workspace.available)
        .map((workspace) => workspace.context),
      [context],
    );
    assert.equal(
      availability.availableWorkspaces.find(
        (workspace) => workspace.context === context,
      )?.source,
      "ACCOUNT_CONTEXT",
    );
  }
});

test("workspace availability follows ADMIN > MANAGER > STAFF priority", () => {
  assert.equal(
    buildWorkspaceAvailability({
      accountContexts: [
        "ADMIN_CONSOLE",
        "MANAGER_CONSOLE",
        "STAFF_CONSOLE",
      ],
      legacyActorKind: "STAFF",
    }).primaryWorkspace,
    "ADMIN_CONSOLE",
  );
  assert.equal(
    buildWorkspaceAvailability({
      accountContexts: ["MANAGER_CONSOLE", "STAFF_CONSOLE"],
      legacyActorKind: "ADMIN",
    }).primaryWorkspace,
    "MANAGER_CONSOLE",
  );
  assert.equal(
    buildWorkspaceAvailability({
      accountContexts: ["STAFF_CONSOLE"],
      legacyActorKind: "ADMIN",
    }).primaryWorkspace,
    "STAFF_CONSOLE",
  );
});

test("actorKind does not decide workspace availability", () => {
  const adminWithoutContext = buildWorkspaceAvailability({
    accountContexts: [],
    legacyActorKind: "ADMIN",
  });
  assert.equal(adminWithoutContext.primaryWorkspace, null);
  assert.deepEqual(
    adminWithoutContext.availableWorkspaces
      .filter((workspace) => workspace.available)
      .map((workspace) => workspace.context),
    [],
  );

  const staffWithManagerContext = buildWorkspaceAvailability({
    accountContexts: ["MANAGER_CONSOLE"],
    legacyActorKind: "STAFF",
  });
  assert.equal(staffWithManagerContext.primaryWorkspace, "MANAGER_CONSOLE");
  assert.deepEqual(
    staffWithManagerContext.availableWorkspaces
      .filter((workspace) => workspace.available)
      .map((workspace) => workspace.context),
    ["MANAGER_CONSOLE"],
  );

  const adminWithStaffContext = buildWorkspaceAvailability({
    accountContexts: ["STAFF_CONSOLE"],
    legacyActorKind: "ADMIN",
  });
  assert.equal(adminWithStaffContext.primaryWorkspace, "STAFF_CONSOLE");
  assert.deepEqual(
    adminWithStaffContext.sourceTrace.find(
      (trace) => trace.source === "LEGACY_ACTOR_KIND",
    )?.grantsWorkspaceAuthority,
    false,
  );
});

