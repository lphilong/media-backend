import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request } from "express";
import { bindCommand } from "@app/base/command.middleware";
import { Actor } from "@core/actor/actor";
import {
  OrgUnitAdminQueryController,
} from "@modules/org-unit/admin/admin.org-unit.query.controller";
import { OrgUnitValidationError } from "@modules/org-unit/domain/org-unit.errors";
import {
  TalentAdminQueryController,
} from "@modules/talent/admin/admin.talent.query.controller";
import { TalentValidationError } from "@modules/talent/domain/talent.errors";
import {
  PlatformAccountAdminQueryController,
} from "@modules/platform-account/admin/admin.platform-account.query.controller";
import { PlatformAccountValidationError } from "@modules/platform-account/domain/platform-account.errors";

class OrgUnitControllerHarness extends OrgUnitAdminQueryController {
  async invoke(req: Request, actor: Actor): Promise<unknown> {
    return this.handle(req, actor, "ADMIN");
  }
}

class TalentControllerHarness extends TalentAdminQueryController {
  async invoke(req: Request, actor: Actor): Promise<unknown> {
    return this.handle(req, actor, "ADMIN");
  }
}

class PlatformAccountControllerHarness extends PlatformAccountAdminQueryController {
  async invoke(req: Request, actor: Actor): Promise<unknown> {
    return this.handle(req, actor, "ADMIN");
  }
}

function createAdminActor(): Actor {
  return new Actor({
    id: "admin-user-1",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [],
    isActive: true,
  });
}

function createRequest(params: {
  readonly command: string;
  readonly query?: Record<string, unknown>;
  readonly params?: Record<string, string>;
}): Request {
  const req = {
    query: params.query ?? {},
    params: params.params ?? {},
  } as unknown as Request;

  bindCommand(req, params.command);
  return req;
}

async function assertUnsupportedQueryRejected(
  promise: Promise<unknown>,
  ErrorType: abstract new (...args: never[]) => Error,
): Promise<void> {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ErrorType);
    assert.match(
      (error as Error).message,
      /unsupported field/i,
    );
    return true;
  });
}

test(
  "A-001 Org Unit query endpoints reject unsupported query keys",
  async (t) => {
    const actor = createAdminActor();

    await t.test("flat list", async () => {
      let serviceReached = false;
      const controller = new OrgUnitControllerHarness({
        listOrgUnits: async () => {
          serviceReached = true;
          return { items: [] };
        },
      } as never);
      const req = createRequest({
        command: "ORG_UNIT_LIST",
        query: { rogue: "1" },
      });

      await assertUnsupportedQueryRejected(
        controller.invoke(req, actor),
        OrgUnitValidationError,
      );
      assert.equal(serviceReached, false);
    });

    await t.test("roots", async () => {
      let serviceReached = false;
      const controller = new OrgUnitControllerHarness({
        listRootOrgUnits: async () => {
          serviceReached = true;
          return { items: [] };
        },
      } as never);
      const req = createRequest({
        command: "ORG_UNIT_LIST_ROOTS",
        query: { status: "ACTIVE" },
      });

      await assertUnsupportedQueryRejected(
        controller.invoke(req, actor),
        OrgUnitValidationError,
      );
      assert.equal(serviceReached, false);
    });

    await t.test("children", async () => {
      let serviceReached = false;
      const controller = new OrgUnitControllerHarness({
        listDirectChildren: async () => {
          serviceReached = true;
          return { items: [] };
        },
      } as never);
      const req = createRequest({
        command: "ORG_UNIT_LIST_CHILDREN",
        params: { orgUnitId: "org-1" },
        query: { search: "ops" },
      });

      await assertUnsupportedQueryRejected(
        controller.invoke(req, actor),
        OrgUnitValidationError,
      );
      assert.equal(serviceReached, false);
    });

    await t.test("detail", async () => {
      let serviceReached = false;
      const controller = new OrgUnitControllerHarness({
        getOrgUnitDetail: async () => {
          serviceReached = true;
          return { id: "org-1" };
        },
      } as never);
      const req = createRequest({
        command: "ORG_UNIT_GET_DETAIL",
        params: { orgUnitId: "org-1" },
        query: { include: "children" },
      });

      await assertUnsupportedQueryRejected(
        controller.invoke(req, actor),
        OrgUnitValidationError,
      );
      assert.equal(serviceReached, false);
    });
  },
);

test(
  "A-001 Talent detail rejects unsupported query keys",
  async () => {
    const actor = createAdminActor();
    let serviceReached = false;
    const controller = new TalentControllerHarness({
      getTalentDetail: async () => {
        serviceReached = true;
        return { id: "talent-1" };
      },
    } as never);
    const req = createRequest({
      command: "TALENT_GET_DETAIL",
      params: { talentId: "talent-1" },
      query: { include: "manager" },
    });

    await assertUnsupportedQueryRejected(
      controller.invoke(req, actor),
      TalentValidationError,
    );
    assert.equal(serviceReached, false);
  },
);

test(
  "A-001 Platform Account detail rejects unsupported query keys",
  async () => {
    const actor = createAdminActor();
    let serviceReached = false;
    const controller = new PlatformAccountControllerHarness({
      getPlatformAccountDetail: async () => {
        serviceReached = true;
        return { id: "platform-account-1" };
      },
    } as never);
    const req = createRequest({
      command: "PLATFORM_ACCOUNT_GET_DETAIL",
      params: { platformAccountId: "platform-account-1" },
      query: { include: "owner" },
    });

    await assertUnsupportedQueryRejected(
      controller.invoke(req, actor),
      PlatformAccountValidationError,
    );
    assert.equal(serviceReached, false);
  },
);

test(
  "A-001 valid target query shapes still pass the controller boundary",
  async (t) => {
    const actor = createAdminActor();

    await t.test("Org Unit flat list allowlist", async () => {
      const controller = new OrgUnitControllerHarness({
        listOrgUnits: async (_actor: Actor, query: unknown) =>
          query,
      } as never);
      const req = createRequest({
        command: "ORG_UNIT_LIST",
        query: {
          status: "ACTIVE",
          type: "DEPARTMENT",
          parentOrgUnitId: "org-parent",
          limit: "20",
          cursor: "cursor-1",
          search: "ops",
          sortBy: "name",
          sortDirection: "ASC",
        },
      });

      assert.deepEqual(await controller.invoke(req, actor), {
        status: "ACTIVE",
        type: "DEPARTMENT",
        parentOrgUnitId: "org-parent",
        rootOnly: undefined,
        limit: "20",
        cursor: "cursor-1",
        search: "ops",
        sortBy: "name",
        sortDirection: "ASC",
      });
    });

    await t.test("Org Unit roots allowlist", async () => {
      const controller = new OrgUnitControllerHarness({
        listRootOrgUnits: async (
          _actor: Actor,
          query: unknown,
        ) => query,
      } as never);
      const req = createRequest({
        command: "ORG_UNIT_LIST_ROOTS",
        query: { limit: "10", cursor: "cursor-1" },
      });

      assert.deepEqual(await controller.invoke(req, actor), {
        limit: "10",
        cursor: "cursor-1",
      });
    });

    await t.test("Org Unit children allowlist", async () => {
      const controller = new OrgUnitControllerHarness({
        listDirectChildren: async (
          _actor: Actor,
          query: unknown,
        ) => query,
      } as never);
      const req = createRequest({
        command: "ORG_UNIT_LIST_CHILDREN",
        params: { orgUnitId: "org-1" },
        query: { limit: "10", cursor: "cursor-1" },
      });

      assert.deepEqual(await controller.invoke(req, actor), {
        orgUnitId: "org-1",
        limit: "10",
        cursor: "cursor-1",
      });
    });

    await t.test("detail endpoints without query params", async () => {
      const orgUnitController = new OrgUnitControllerHarness({
        getOrgUnitDetail: async (
          _actor: Actor,
          query: unknown,
        ) => query,
      } as never);
      const talentController = new TalentControllerHarness({
        getTalentDetail: async (
          _actor: Actor,
          query: unknown,
        ) => query,
      } as never);
      const platformAccountController =
        new PlatformAccountControllerHarness({
          getPlatformAccountDetail: async (
            _actor: Actor,
            query: unknown,
          ) => query,
        } as never);

      assert.deepEqual(
        await orgUnitController.invoke(
          createRequest({
            command: "ORG_UNIT_GET_DETAIL",
            params: { orgUnitId: "org-1" },
          }),
          actor,
        ),
        { orgUnitId: "org-1" },
      );
      assert.deepEqual(
        await talentController.invoke(
          createRequest({
            command: "TALENT_GET_DETAIL",
            params: { talentId: "talent-1" },
          }),
          actor,
        ),
        { talentId: "talent-1" },
      );
      assert.deepEqual(
        await platformAccountController.invoke(
          createRequest({
            command: "PLATFORM_ACCOUNT_GET_DETAIL",
            params: {
              platformAccountId: "platform-account-1",
            },
          }),
          actor,
        ),
        { platformAccountId: "platform-account-1" },
      );
    });
  },
);
