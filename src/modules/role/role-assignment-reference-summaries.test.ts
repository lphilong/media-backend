import assert from "node:assert/strict";
import { test } from "node:test";
import { NativeMongoRoleAssignmentReadRepository } from "@infra/mongo/role/role.read-repository";
import { RoleAdminAssignmentExposure } from "@modules/role/shared/role.exposure";

type FindCall = {
  readonly collection: string;
  readonly query: unknown;
  readonly options: unknown;
};

const assignment = {
  _id: "assignment-1",
  roleId: "role-1",
  userId: "user-1",
  state: "ACTIVE",
  effectiveAt: 1,
  revokedAt: null,
  reason: null,
  createdAt: 1,
  updatedAt: 2,
};

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
    toArray: async () => [...documents],
  };
}

test("Role assignment userRef is additive, readable, and assignment IDs stay internal", async () => {
  const calls: FindCall[] = [];
  const repository = new NativeMongoRoleAssignmentReadRepository({
    collection(name: string) {
      return {
        find(query: unknown, options: unknown) {
          calls.push({ collection: name, query, options });
          if (name === "role_assignments") {
            return createFindResult([assignment]);
          }
          if (name === "users") {
            return createFindResult([
              {
                _id: "user-1",
                profile: {
                  displayName: "Admin User",
                  email: "admin@example.test",
                },
                accountStatus: "ACTIVE",
                disabledAt: null,
                archivedAt: null,
              },
            ]);
          }
          return createFindResult([]);
        },
      };
    },
  } as never);

  const result = await repository.listRoleAssignments({
    roleId: "role-1",
    limit: 10,
  });

  assert.equal(result.items[0].assignmentId, "assignment-1");
  assert.equal(result.items[0].userId, "user-1");
  assert.deepEqual(result.items[0].userRef, {
    id: "user-1",
    displayName: "Admin User",
    name: "admin@example.test",
    status: "ACTIVE",
  });
  assert.equal(
    RoleAdminAssignmentExposure.expose(result.items[0]).userRef !== undefined,
    true,
  );
  assert.equal(calls.filter((call) => call.collection === "users").length, 1);
  assert.deepEqual(
    calls.find((call) => call.collection === "users")?.options,
    {
      projection: {
        _id: 1,
        profile: 1,
        accountStatus: 1,
      },
    },
  );
});
