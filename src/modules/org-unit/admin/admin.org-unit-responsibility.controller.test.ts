import assert from "node:assert/strict";
import test from "node:test";
import { Request } from "express";
import { bindCommand } from "@app/base/command.middleware";
import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { OrgUnitValidationError } from "@modules/org-unit/domain/org-unit.errors";
import { RevokeOrgUnitResponsibilityCommand } from "@modules/org-unit/shared/org-unit.contracts";
import { OrgUnitResponsibilityAdminService } from "./admin.org-unit-responsibility.service";
import { OrgUnitResponsibilityAdminController } from "./admin.org-unit-responsibility.controller";

test("Org Unit responsibility controller accepts only a valid revoke reason and forwards it", async () => {
  const service = new ControllerServiceStub();
  const controller = new TestableOrgUnitResponsibilityController(service);

  const result = await controller.run(
    requestFor("ORG_UNIT_RESPONSIBILITY_REVOKE", {
      body: { reason: "scope reassigned" },
    }),
  );

  assert.deepEqual(result, { accepted: true });
  assert.deepEqual(service.revokeCommands, [
    {
      orgUnitId: "org-1",
      assignmentId: "assignment-1",
      reason: "scope reassigned",
    },
  ]);
});

test("Org Unit responsibility controller forwards missing and blank revoke reasons to canonical validation", async () => {
  const service = new ControllerServiceStub();
  const controller = new TestableOrgUnitResponsibilityController(service);

  for (const body of [{}, { reason: "" }, { reason: "   " }]) {
    await assert.rejects(
      () =>
        controller.run(
          requestFor("ORG_UNIT_RESPONSIBILITY_REVOKE", { body }),
        ),
      OrgUnitValidationError,
    );
  }

  assert.equal(service.revokeCommands.length, 3);
});

test("Org Unit responsibility controller rejects unexpected revoke fields before service execution", async () => {
  const service = new ControllerServiceStub();
  const controller = new TestableOrgUnitResponsibilityController(service);

  await assert.rejects(
    () =>
      controller.run(
        requestFor("ORG_UNIT_RESPONSIBILITY_REVOKE", {
          body: { reason: "scope reassigned", unexpected: true },
        }),
      ),
    OrgUnitValidationError,
  );

  assert.equal(service.revokeCommands.length, 0);
});

test("Org Unit responsibility controller rejects reason on list while preserving an empty-query list", async () => {
  const service = new ControllerServiceStub();
  const controller = new TestableOrgUnitResponsibilityController(service);

  await assert.rejects(
    () =>
      controller.run(
        requestFor("ORG_UNIT_RESPONSIBILITY_LIST", { query: { reason: "not-a-filter" } }),
      ),
    OrgUnitValidationError,
  );

  await controller.run(requestFor("ORG_UNIT_RESPONSIBILITY_LIST"));
  assert.equal(service.listCalls, 1);
});

test("Org Unit responsibility controller retains the fail-closed out-of-scope revoke path after body validation", async () => {
  const service = new ControllerServiceStub();
  const controller = new TestableOrgUnitResponsibilityController(service);

  await assert.rejects(
    () =>
      controller.run(
        requestFor("ORG_UNIT_RESPONSIBILITY_REVOKE", {
          orgUnitId: "out-of-scope-org",
          body: { reason: "scope reassigned" },
        }),
      ),
    OrgUnitValidationError,
  );

  assert.equal(service.revokeCommands.length, 1);
});

class TestableOrgUnitResponsibilityController extends OrgUnitResponsibilityAdminController {
  constructor(service: ControllerServiceStub) {
    super(service as unknown as OrgUnitResponsibilityAdminService);
  }

  run(req: Request): Promise<unknown> {
    const actor = new Actor({
      id: "admin-user",
      type: "admin",
      context: "ADMIN",
      roles: [],
      permissions: [Permission.ORG_UNIT_READ, Permission.ORG_UNIT_UPDATE],
      scopeGrants: {},
      accountContexts: ["ADMIN_CONSOLE"],
      isActive: true,
    });
    return this.handle(req, actor, actor.context);
  }
}

class ControllerServiceStub {
  readonly revokeCommands: RevokeOrgUnitResponsibilityCommand[] = [];
  listCalls = 0;

  async listResponsibilities(): Promise<{ readonly items: readonly [] }> {
    this.listCalls += 1;
    return { items: [] };
  }

  async revokeResponsibility(
    _actor: Actor,
    command: RevokeOrgUnitResponsibilityCommand,
  ): Promise<{ readonly accepted: true }> {
    this.revokeCommands.push(command);
    if (command.orgUnitId === "out-of-scope-org") {
      throw new OrgUnitValidationError("Org unit is outside the actor scope");
    }
    if (typeof command.reason !== "string" || command.reason.trim().length === 0) {
      throw new OrgUnitValidationError("reason is required");
    }
    return { accepted: true };
  }
}

function requestFor(
  command: "ORG_UNIT_RESPONSIBILITY_LIST" | "ORG_UNIT_RESPONSIBILITY_REVOKE",
  options: {
    readonly orgUnitId?: string;
    readonly body?: unknown;
    readonly query?: Record<string, string>;
  } = {},
): Request {
  const req = Object.create(null) as Request;
  req.params = {
    orgUnitId: options.orgUnitId ?? "org-1",
    assignmentId: "assignment-1",
  };
  req.query = options.query ?? {};
  req.body = options.body;
  bindCommand(req, command);
  return req;
}
