import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request } from "express";
import { Permission } from "@core/permission/permission.enum";
import { bindContext } from "@core/context/context.middleware";
import { Auth0ActorResolver } from "@app/auth/auth0.actor.resolver";
import {
  createActorSnapshotEnvelope,
} from "@infra/cache/actor.snapshot.cache";
import { CacheKey } from "@infra/cache/cache.key";
import type {
  CacheAdapter,
  CacheGetOptions,
  CacheSetOptions,
} from "@infra/cache/cache.adapter";
import type {
  UserAuthResolutionCandidate,
} from "@modules/user/shared/user.actor-resolution.facade";

class InMemoryCache implements CacheAdapter {
  private readonly values = new Map<string, unknown>();

  readonly deletedKeys: string[] = [];
  readonly setCalls: Array<{
    key: string;
    value: unknown;
    options: CacheSetOptions;
  }> = [];

  setInitialValue(key: string, value: unknown): void {
    this.values.set(key, value);
  }

  async get<T>(
    key: string,
    _options?: CacheGetOptions,
  ): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  async set<T>(
    key: string,
    value: T,
    options: CacheSetOptions,
  ): Promise<void> {
    this.values.set(key, value);
    this.setCalls.push({ key, value, options });
  }

  async del(key: string): Promise<void> {
    this.values.delete(key);
    this.deletedKeys.push(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.values.has(key);
  }
}

test(
  "Auth0ActorResolver ignores cached snapshots with invalid commission scope grants",
  async () => {
    const repository = {
      async findByAuthSubject(): Promise<
        readonly UserAuthResolutionCandidate[]
      > {
        return [
          {
            userId: "admin-user-1",
            actorKind: "ADMIN",
            accountStatus: "ACTIVE",
            permissions: [
              Permission.COMMISSION_RULE_READ,
            ],
            scopeGrants: {
              commission: ["global"],
            },
          },
        ];
      },
      async readAuthSecurityVersion(): Promise<string> {
        return "v1";
      },
    };

    const cache = new InMemoryCache();
    cache.setInitialValue(
      CacheKey.actorSnapshot(
        "ADMIN",
        "auth0|admin-user-1",
      ),
      createActorSnapshotEnvelope(
        {
          id: "cached-user",
          type: "admin",
          context: "ADMIN",
          roles: [],
          permissions: [
            Permission.COMMISSION_RULE_READ,
          ],
          scopeGrants: {
            commission: ["department"],
          },
          isActive: true,
        },
        "v1",
      ),
    );

    const resolver = new Auth0ActorResolver(
      repository,
      cache,
    );
    const req = {
      ip: "127.0.0.1",
      headers: {
        "x-trace-id": "trace-auth0-resolver-test",
        "user-agent": "node-test",
      },
      auth: {
        payload: {
          sub: "auth0|admin-user-1",
        },
      },
    } as unknown as Request & {
      auth: {
        payload: {
          sub: string;
        };
      };
    };

    bindContext(req, "ADMIN");

    const actor = await resolver.resolve(req);

    assert.equal(actor.id, "admin-user-1");
    assert.deepEqual(actor.scopeGrants.commission, [
      "global",
    ]);
    assert.equal(cache.deletedKeys.length, 1);
    assert.equal(cache.setCalls.length, 1);
  },
);

test(
  "Auth0ActorResolver refreshes cached permissions at assignment lifecycle boundaries",
  async () => {
    let repositoryCalls = 0;
    const repository = {
      async findByAuthSubject(): Promise<
        readonly UserAuthResolutionCandidate[]
      > {
        repositoryCalls += 1;
        return [
          {
            userId: "admin-user-1",
            actorKind: "ADMIN",
            accountStatus: "ACTIVE",
            permissions: [Permission.USER_VIEW],
            authorizationValidUntil: Date.now() + 60_000,
          },
        ];
      },
      async readAuthSecurityVersion(): Promise<string> {
        return "v1";
      },
    };
    const cache = new InMemoryCache();
    const cacheKey = CacheKey.actorSnapshot(
      "ADMIN",
      "auth0|admin-user-1",
    );
    cache.setInitialValue(
      cacheKey,
      createActorSnapshotEnvelope(
        {
          id: "admin-user-1",
          type: "admin",
          context: "ADMIN",
          roles: [],
          permissions: [Permission.ROLE_CREATE],
          scopeGrants: {},
          isActive: true,
          authorizationValidUntil: Date.now() - 1,
        },
        "v1",
      ),
    );
    const resolver = new Auth0ActorResolver(repository, cache);
    const req = {
      ip: "127.0.0.1",
      headers: {
        "x-trace-id": "trace-auth0-lifecycle-boundary",
        "user-agent": "node-test",
      },
      auth: {
        payload: {
          sub: "auth0|admin-user-1",
        },
      },
    } as unknown as Request & {
      auth: { payload: { sub: string } };
    };
    bindContext(req, "ADMIN");

    const actor = await resolver.resolve(req);

    assert.equal(repositoryCalls, 1);
    assert.deepEqual(actor.permissions, [Permission.USER_VIEW]);
    assert.deepEqual(cache.deletedKeys, [cacheKey]);
    assert.equal(cache.setCalls.length, 1);
    assert.equal(
      (
        cache.setCalls[0]?.value as {
          snapshot: { authorizationValidUntil?: number };
        }
      ).snapshot.authorizationValidUntil !== undefined,
      true,
    );
  },
);
