import assert from "node:assert/strict";
import { test } from "node:test";
import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { SystemInvariantError } from "@core/error/system-error";
import { ReferenceLookupAdminService } from "@modules/reference-lookup/admin/admin.reference-lookup.service";
import {
  ListReferenceLookupInput,
  ReferenceLookupReadRepository,
} from "@modules/reference-lookup/read/reference-lookup.read-repository";
import { ReferenceLookupItem } from "@modules/reference-lookup/shared/reference-lookup.contracts";
import { escapeReferenceLookupRegex } from "@infra/mongo/reference-lookup/reference-lookup.read-repository";

test("reference lookup requires lookup or full read permission", async () => {
  const repository = new CapturingReferenceLookupRepository();
  const service = new ReferenceLookupAdminService(repository);

  await assert.rejects(
    () =>
      service.listReferenceOptions(createActor([]), {
        domain: "talents",
      }),
    (error: unknown) =>
      error instanceof SystemInvariantError &&
      error.code === "PERMISSION_DENIED",
  );
});

test("reference lookup permission retrieves minimal selectable DTOs", async () => {
  const repository = new CapturingReferenceLookupRepository([
    {
      id: "talent-1",
      label: "Mina",
      code: "TAL-000001",
      status: "ACTIVE",
    },
  ]);
  const service = new ReferenceLookupAdminService(repository);

  const result = await service.listReferenceOptions(
    createActor([Permission.TALENT_LOOKUP]),
    {
      domain: "talents",
      search: " Mina ",
      limit: "500",
    },
  );

  assert.deepEqual(repository.lastInput, {
    domain: "talents",
    search: "Mina",
    ids: undefined,
    limit: 50,
  });
  assert.deepEqual(result, {
    items: [
      {
        id: "talent-1",
        label: "Mina",
        code: "TAL-000001",
        status: "ACTIVE",
      },
    ],
  });
  assert.equal("secret" in result.items[0], false);
});

test("studio resource lookup permission can retrieve selected references by id without read", async () => {
  const repository = new CapturingReferenceLookupRepository([
    {
      id: "studio-1",
      label: "Main Studio",
      code: "SR-000001",
      status: "ACTIVE",
      type: "ROOM",
    },
  ]);
  const service = new ReferenceLookupAdminService(repository);

  const result = await service.listReferenceOptions(
    createActor([Permission.STUDIO_RESOURCE_LOOKUP]),
    {
      domain: "studioResources",
      ids: " studio-1,studio-1 ",
      limit: "20",
    },
  );

  assert.deepEqual(repository.lastInput, {
    domain: "studioResources",
    ids: ["studio-1"],
    search: undefined,
    limit: 20,
  });
  assert.deepEqual(result.items, [
    {
      id: "studio-1",
      label: "Main Studio",
      code: "SR-000001",
      status: "ACTIVE",
      type: "ROOM",
    },
  ]);
});

test("full module read permission also satisfies reference lookup", async () => {
  const repository = new CapturingReferenceLookupRepository();
  const service = new ReferenceLookupAdminService(repository);

  await service.listReferenceOptions(
    createActor([Permission.PLATFORM_ACCOUNT_READ]),
    {
      domain: "platformAccounts",
      limit: 10,
    },
  );

  assert.equal(repository.lastInput?.domain, "platformAccounts");
});

test("reference lookup regex search is escaped before Mongo matching", () => {
  assert.equal(
    escapeReferenceLookupRegex("Mina.*(ops)?"),
    "Mina\\.\\*\\(ops\\)\\?",
  );
});

function createActor(permissions: readonly string[]): Actor {
  return new Actor({
    id: "admin-user-1",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions,
    scopeGrants: {},
    accountContexts: ["ADMIN_CONSOLE"],
    isActive: true,
  });
}

class CapturingReferenceLookupRepository implements ReferenceLookupReadRepository {
  lastInput?: ListReferenceLookupInput;

  constructor(private readonly items: readonly ReferenceLookupItem[] = []) {}

  async listReferenceOptions(
    input: ListReferenceLookupInput,
  ): Promise<readonly ReferenceLookupItem[]> {
    this.lastInput = input;
    return this.items;
  }
}
