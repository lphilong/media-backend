import assert from "node:assert/strict";
import { test } from "node:test";
import { type AxiosInstance } from "axios";
import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import { bindTraceId } from "@core/trace/trace.context";
import { Permission } from "@core/permission/permission.enum";
import { AuthoritativeAdminMutationBridge } from "@core/application/authoritative-admin-mutation.bridge";
import { AuditGuard } from "@core/audit/audit.guard";
import { ActorSnapshotCacheInvalidator } from "@infra/cache/actor.snapshot.cache";
import {
  Auth0ManagementHttpClient,
  DisabledAuth0ManagementClient,
} from "@infra/auth0/auth0-management.client";
import { InfrastructureError } from "@infra/errors/infrastructure.error";
import { resolveAuthoritativePermissionForMutationIdentity } from "@core/application/authoritative-admin-mutation.permission-map";
import { UserLifecycleService } from "@modules/user/admin/admin.user.service";
import {
  CreateUserInput,
  SetUserAuthLinkageInput,
  TransitionUserLifecycleInput,
  UpdateUserProfileInput,
  UpdateUserPreferencesInput,
  UserMutationRepository,
} from "@modules/user/domain/user.repository";
import {
  Auth0CreateDatabaseUserInput,
  Auth0ManagementPort,
  Auth0ManagementUser,
  Auth0PasswordChangeTicketInput,
  Auth0PasswordResetEmailInput,
} from "@modules/user/domain/auth0-management.port";
import { UserAdminCapabilityRepository } from "@modules/user/domain/user.admin-capability.repository";
import {
  UserAccountStatus,
  UserDetailView,
  UserListItemView,
  UserRecord,
} from "@modules/user/domain/user.types";
import { UserValidationError } from "@modules/user/domain/user.errors";
import { UserAdminQueryService } from "@modules/user/admin/admin.user.query-service";
import {
  ListUserReadInput,
  ListUserReadResult,
  UserReadRepository,
} from "@modules/user/read/user.read-repository";
import {
  UserAdminDetailExposure,
  UserAdminListExposure,
} from "@modules/user/shared/user.exposure";
import {
  UserActorResolutionFacade,
  UserAuthResolutionRepository,
} from "@modules/user/shared/user.actor-resolution.facade";
import { runWithDomainEventCollector } from "@system/event-bridge/domain-event.types";

test("user list exposure includes auth linkage status but not subject", () => {
  const exposed = UserAdminListExposure.expose({
    id: "user-list",
    displayName: "List User",
    email: "list@example.test",
    actorKind: "ADMIN",
    accountStatus: "ACTIVE",
    authLinkage: {
      status: "LINKED",
    },
    updatedAt: 2,
  } satisfies UserListItemView);
  const authLinkage = exposed.authLinkage as Record<string, unknown>;

  assert.deepEqual(authLinkage, {
    status: "LINKED",
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(authLinkage, "subject"),
    false,
  );
});

test("user detail exposure keeps existing auth linkage detail fields", () => {
  const exposed = UserAdminDetailExposure.expose({
    id: "user-detail",
    actorKind: "ADMIN",
    accountStatus: "ACTIVE",
    authLinkage: {
      provider: "auth0",
      subject: "auth0|detail",
      status: "LINKED",
    },
    profile: {
      displayName: "Detail User",
      email: "detail@example.test",
    },
    contextAccess: {
      contexts: ["ADMIN"],
    },
    preferences: {
      locale: "en",
      timezone: "Asia/Saigon",
    },
    createdAt: 1,
    updatedAt: 2,
    activatedAt: 2,
    disabledAt: null,
    archivedAt: null,
  } satisfies UserDetailView);
  const authLinkage = exposed.authLinkage as Record<string, unknown>;

  assert.deepEqual(authLinkage, {
    provider: "auth0",
    subject: "auth0|detail",
    status: "LINKED",
  });
});

test("user admin query forwards unlinked employment profile filter", async () => {
  const readRepository = new RecordingUserReadRepository();
  const service = new UserAdminQueryService(readRepository);

  await service.listUsers(createActor([Permission.USER_VIEW]), {
    hasEmploymentProfile: "false",
    limit: "25",
  });

  assert.deepEqual(readRepository.listInputs[0], {
    actorKind: undefined,
    cursor: undefined,
    hasEmploymentProfile: false,
    limit: 25,
    search: undefined,
    state: undefined,
  });
});

test("user admin query rejects invalid employment profile filter", async () => {
  const readRepository = new RecordingUserReadRepository();
  const service = new UserAdminQueryService(readRepository);

  await assert.rejects(
    () =>
      service.listUsers(createActor([Permission.USER_VIEW]), {
        hasEmploymentProfile: "maybe",
      }),
    UserValidationError,
  );

  assert.equal(readRepository.listInputs.length, 0);
});

const ALL_PERMISSIONS = Object.values(Permission);

test("provision user creates internal user, links Auth0, and sends Auth0 setup email", async () => {
  const repo = new InMemoryUserRepository();
  const auth0 = new MockAuth0Management();
  const audit = new RecordingAuditGuard();
  const service = createService(repo, auth0, audit);

  const result = await runService(() =>
    service.provisionUser(createActor(ALL_PERMISSIONS), {
      displayName: "Jane Admin",
      email: " Jane.Admin@Example.test ",
    }),
  );

  assert.equal(repo.records.length, 1);
  assert.equal(result.user.actorKind, "ADMIN");
  assert.equal(result.user.profile.email, "jane.admin@example.test");
  assert.equal(result.user.authLinkage.subject, "auth0|jane.admin");
  assert.equal(result.provisioning?.auth0UserCreated, true);
  assert.equal(result.provisioning?.invitationEmailSent, true);
  assert.equal(result.provisioning?.invitationTicketCreated, false);
  assert.equal(result.provisioning?.passwordSetupDeliveryMode, "auth0_email");
  assert.equal(result.passwordSetup?.emailSent, true);
  assert.equal(result.passwordSetup?.ticketCreated, false);
  assert.equal(auth0.createUserCalls.length, 1);
  assert.equal(typeof auth0.createUserCalls[0]?.password, "string");
  assert.match(auth0.createUserCalls[0]?.password ?? "", /[A-Z]/u);
  assert.match(auth0.createUserCalls[0]?.password ?? "", /[a-z]/u);
  assert.match(auth0.createUserCalls[0]?.password ?? "", /[0-9]/u);
  assert.match(auth0.createUserCalls[0]?.password ?? "", /[!#]/u);
  assert.ok((auth0.createUserCalls[0]?.password.length ?? 0) >= 32);
  assert.equal(auth0.emailCalls.length, 1);
  assert.deepEqual(auth0.emailCalls[0], {
    email: "jane.admin@example.test",
    connection: "Username-Password-Authentication",
    clientId: "client-id",
  });
  assert.equal(auth0.ticketCalls.length, 0);

  const serializedResult = JSON.stringify(result);
  const serializedAudit = JSON.stringify(audit.records);
  assert.equal(serializedResult.includes("ticket.example.test"), false);
  assert.equal(serializedAudit.includes("ticket.example.test"), false);
  assert.equal(serializedResult.includes("TempSecret"), false);
  assert.equal(serializedAudit.includes("TempSecret"), false);
});

test("duplicate email rejects before Auth0 mutation", async () => {
  const repo = new InMemoryUserRepository();
  repo.records.push(userRecord({ email: "ops@example.test" }));
  const auth0 = new MockAuth0Management();
  const service = createService(repo, auth0);

  await assert.rejects(
    () =>
      runService(() =>
        service.provisionUser(createActor(ALL_PERMISSIONS), {
          displayName: "Ops Two",
          email: "OPS@example.test",
        }),
      ),
    /User email already exists/,
  );
  assert.equal(auth0.createUserCalls.length, 0);
});

test("missing Auth0 Management config fails closed without internal user", async () => {
  const repo = new InMemoryUserRepository();
  const service = createService(repo, new DisabledAuth0ManagementClient());

  await assert.rejects(
    () =>
      runService(() =>
        service.provisionUser(createActor(ALL_PERMISSIONS), {
          displayName: "No Config",
          email: "no-config@example.test",
        }),
      ),
    /Auth0 Management API config is missing/,
  );
  assert.equal(repo.records.length, 0);
});

test("Auth0 create failure does not create internal user", async () => {
  const repo = new InMemoryUserRepository();
  const auth0 = new MockAuth0Management();
  auth0.failCreate = true;
  const service = createService(repo, auth0);

  await assert.rejects(
    () =>
      runService(() =>
        service.provisionUser(createActor(ALL_PERMISSIONS), {
          displayName: "Fail Create",
          email: "fail-create@example.test",
        }),
      ),
    /Auth0 create failed/,
  );
  assert.equal(repo.records.length, 0);
});

test("existing Auth0 user by email is reused without creating password", async () => {
  const repo = new InMemoryUserRepository();
  const auth0 = new MockAuth0Management();
  auth0.usersById.set("auth0|existing", {
    id: "auth0|existing",
    email: "existing@example.test",
  });
  const service = createService(repo, auth0);

  const result = await runService(() =>
    service.provisionUser(createActor(ALL_PERMISSIONS), {
      displayName: "Existing User",
      email: "EXISTING@example.test",
    }),
  );

  assert.equal(result.user.authLinkage.subject, "auth0|existing");
  assert.equal(result.provisioning?.auth0UserCreated, false);
  assert.equal(auth0.createUserCalls.length, 0);
  assert.equal(auth0.emailCalls.length, 1);
  assert.equal(auth0.ticketCalls.length, 0);
});

test("manual auth link validates Auth0 subject and rejects duplicates", async () => {
  const repo = new InMemoryUserRepository();
  repo.records.push(
    userRecord({ id: "user-a", authSubject: "auth0|old" }),
    userRecord({ id: "user-b", authSubject: "auth0|taken" }),
  );
  const auth0 = new MockAuth0Management();
  auth0.usersById.set("auth0|new", {
    id: "auth0|new",
    email: "new@example.test",
  });
  const service = createService(repo, auth0);

  await runService(() =>
    service.setAuthLinkage(createActor(ALL_PERMISSIONS), {
      userId: "user-a",
      provider: "auth0",
      subject: "auth0|new",
    }),
  );
  assert.equal(repo.records[0]?.authLinkage.subject, "auth0|new");
  assert.equal(auth0.getUserCalls, 1);

  await assert.rejects(
    () =>
      runService(() =>
        service.setAuthLinkage(createActor(ALL_PERMISSIONS), {
          userId: "user-a",
          provider: "auth0",
          subject: "auth0|taken",
        }),
      ),
    /Auth subject already linked/,
  );
});

test("unlink blocks self lockout and audits successful unlink", async () => {
  const repo = new InMemoryUserRepository();
  repo.records.push(
    userRecord({
      id: "target-user",
      accountStatus: "ACTIVE",
      authSubject: "auth0|target",
    }),
  );
  const audit = new RecordingAuditGuard();
  const bridge = new InlineMutationBridge();
  const service = createService(repo, new MockAuth0Management(), audit, bridge);

  await assert.rejects(
    () =>
      runService(() =>
        service.unlinkAuthLinkage(createActor(ALL_PERMISSIONS, "target-user"), {
          userId: "target-user",
        }),
      ),
    /current actor/,
  );

  const result = await runService(() =>
    service.unlinkAuthLinkage(createActor(ALL_PERMISSIONS), {
      userId: "target-user",
    }),
  );

  assert.equal(result.user.accountStatus, "PENDING");
  assert.equal(result.user.authLinkage.status, "UNLINKED");
  assert.equal(audit.records.length, 1);
  assert.equal(
    audit.records[0]?.metadata.mutationType,
    "user.auth-linkage.unlink",
  );
  assert.equal(bridge.authSecurityChanged, 1);
});

test("password setup sends Auth0 email and audits without returning ticket URL", async () => {
  const repo = new InMemoryUserRepository();
  repo.records.push(
    userRecord({
      id: "setup-user",
      email: "setup@example.test",
      authSubject: "auth0|setup",
    }),
  );
  const auth0 = new MockAuth0Management();
  const audit = new RecordingAuditGuard();
  const service = createService(repo, auth0, audit);

  const result = await runService(() =>
    service.sendPasswordSetup(createActor(ALL_PERMISSIONS), {
      userId: "setup-user",
    }),
  );
  const serialized = JSON.stringify(result);

  assert.equal(auth0.emailCalls.length, 1);
  assert.equal(auth0.ticketCalls.length, 0);
  assert.equal(result.passwordSetup?.deliveryMode, "auth0_email");
  assert.equal(result.passwordSetup?.emailSent, true);
  assert.equal(result.passwordSetup?.ticketCreated, false);
  assert.equal(serialized.includes("ticket.example.test"), false);
  assert.equal(serialized.includes("secret"), false);
  assert.equal(
    audit.records[0]?.metadata.mutationType,
    "user.password-setup.send",
  );
  assert.equal(audit.records[0]?.metadata.deliveryMode, "auth0_email");
  assert.equal(audit.records[0]?.metadata.provider, "auth0");
  assert.equal(audit.records[0]?.metadata.emailSent, true);
  assert.equal(audit.records[0]?.metadata.ticketCreated, false);
  const serializedAudit = JSON.stringify(audit.records);
  assert.equal(serializedAudit.includes("setup@example.test"), false);
  assert.equal(serializedAudit.includes("ticket.example.test"), false);
});

test("password setup backend_ticket mode creates ticket but does not claim email sent", async () => {
  const repo = new InMemoryUserRepository();
  repo.records.push(
    userRecord({
      id: "setup-ticket-user",
      email: "setup-ticket@example.test",
      authSubject: "auth0|setup-ticket",
    }),
  );
  const auth0 = new MockAuth0Management();
  const service = createService(repo, auth0, undefined, undefined, {
    passwordSetupDeliveryMode: "backend_ticket",
  });

  const result = await runService(() =>
    service.sendPasswordSetup(createActor(ALL_PERMISSIONS), {
      userId: "setup-ticket-user",
    }),
  );

  assert.equal(auth0.emailCalls.length, 0);
  assert.equal(auth0.ticketCalls.length, 1);
  assert.equal(result.passwordSetup?.deliveryMode, "backend_ticket");
  assert.equal(result.passwordSetup?.emailSent, false);
  assert.equal(result.passwordSetup?.ticketCreated, true);
  assert.equal(JSON.stringify(result).includes("ticket.example.test"), false);
});

test("password setup rejects unlinked and missing email users before Auth0 delivery", async () => {
  const repo = new InMemoryUserRepository();
  repo.records.push(
    userRecord({
      id: "setup-unlinked",
      email: "setup-unlinked@example.test",
      authSubject: "unlinked:setup-unlinked",
      authStatus: "UNLINKED",
    }),
    userRecord({
      id: "setup-missing-email",
      email: undefined,
      authSubject: "auth0|missing-email",
    }),
  );
  const auth0 = new MockAuth0Management();
  const service = createService(repo, auth0);

  await assert.rejects(
    () =>
      runService(() =>
        service.sendPasswordSetup(createActor(ALL_PERMISSIONS), {
          userId: "setup-unlinked",
        }),
      ),
    /linked Auth0 identity/,
  );

  await assert.rejects(
    () =>
      runService(() =>
        service.sendPasswordSetup(createActor(ALL_PERMISSIONS), {
          userId: "setup-missing-email",
        }),
      ),
    /email address/,
  );

  assert.equal(auth0.emailCalls.length, 0);
  assert.equal(auth0.ticketCalls.length, 0);
});

test("legacy manual create rejects explicit auth binding fields", async () => {
  const repo = new InMemoryUserRepository();
  const service = createService(repo, new MockAuth0Management());

  await assert.rejects(
    () =>
      runService(() =>
        service.createUser(createActor(ALL_PERMISSIONS), {
          authSubject: "auth0|legacy",
          displayName: "Legacy User",
          email: "LEGACY@example.test",
        } as Parameters<UserLifecycleService["createUser"]>[1]),
      ),
    /use USER_PROVISION or USER_AUTH_LINKAGE_SET/,
  );

  await assert.rejects(
    () =>
      runService(() =>
        service.createUser(createActor(ALL_PERMISSIONS), {
          authLinkage: {
            provider: "auth0",
            subject: "auth0|legacy",
          },
          displayName: "Legacy User",
        } as Parameters<UserLifecycleService["createUser"]>[1]),
      ),
    /use USER_PROVISION or USER_AUTH_LINKAGE_SET/,
  );
});

test("legacy manual create creates pending unlinked internal user", async () => {
  const repo = new InMemoryUserRepository();
  const service = createService(repo, new MockAuth0Management());

  const result = await runService(() =>
    service.createUser(createActor(ALL_PERMISSIONS), {
      displayName: "Legacy User",
      email: "LEGACY@example.test",
    }),
  );

  assert.equal(result.user.accountStatus, "PENDING");
  assert.equal(result.user.authLinkage.provider, "auth0");
  assert.equal(result.user.authLinkage.status, "UNLINKED");
  assert.match(result.user.authLinkage.subject, /^unlinked:/u);
  assert.equal(result.user.profile.email, "legacy@example.test");
});

test("Auth0 HTTP client sends database password and redacts HTTP failures", async () => {
  const userBodies: unknown[] = [];
  const resetEmailBodies: unknown[] = [];
  const http = {
    async post(url: string, body: unknown): Promise<{ data: unknown }> {
      if (url === "/oauth/token") {
        return {
          data: {
            access_token: "management-secret-token",
            expires_in: 60,
          },
        };
      }

      if (url === "/api/v2/users") {
        userBodies.push(body);
        return {
          data: {
            user_id: "auth0|adapter",
            email: "adapter@example.test",
          },
        };
      }

      if (url === "/dbconnections/change_password") {
        if (
          typeof body === "object" &&
          body !== null &&
          !Array.isArray(body) &&
          (body as Record<string, unknown>).email === "adapter@example.test"
        ) {
          resetEmailBodies.push(body);
          return {
            data: "We have just sent you an email to reset your password.",
          };
        }

        resetEmailBodies.push(body);
      }

      throw auth0AxiosError();
    },
    async get(): Promise<{ data: unknown }> {
      throw auth0AxiosError();
    },
  } as unknown as AxiosInstance;
  const client = new Auth0ManagementHttpClient(auth0Config(), http);

  await client.createDatabaseUser({
    email: "adapter@example.test",
    displayName: "Adapter User",
    connection: "Username-Password-Authentication",
    password: "TempSecret!123",
    verifyEmail: false,
  });

  assert.deepEqual(userBodies[0], {
    connection: "Username-Password-Authentication",
    email: "adapter@example.test",
    password: "TempSecret!123",
    name: "Adapter User",
    verify_email: false,
  });

  await client.sendPasswordResetEmail({
    email: "adapter@example.test",
    connection: "Username-Password-Authentication",
  });

  assert.deepEqual(resetEmailBodies[0], {
    client_id: "reset-client-id",
    email: "adapter@example.test",
    connection: "Username-Password-Authentication",
  });

  for (const operation of [
    () => client.findUserByEmail("leak@example.test"),
    () =>
      client.createPasswordChangeTicket({
        userId: "auth0|leaky",
      }),
    () => client.getUserById("auth0|leaky"),
    () =>
      client.sendPasswordResetEmail({
        email: "leak@example.test",
        connection: "Username-Password-Authentication",
      }),
  ]) {
    await assert.rejects(operation, assertRedactedAuth0Error);
  }

  const failingTokenClient = new Auth0ManagementHttpClient(auth0Config(), {
    async post(): Promise<{ data: unknown }> {
      throw auth0AxiosError();
    },
  } as unknown as AxiosInstance);

  await assert.rejects(
    () => failingTokenClient.findUserByEmail("leak@example.test"),
    assertRedactedAuth0Error,
  );
});

test("actor resolution remains fail closed for unknown and inactive users", async () => {
  const facade = new UserActorResolutionFacade(
    new StaticAuthResolutionRepository([]),
  );
  await assert.rejects(
    () =>
      facade.resolveByAuthLinkage({
        context: "ADMIN",
        authSubject: "auth0|missing",
      }),
    /missing user/,
  );

  for (const status of ["PENDING", "DISABLED", "ARCHIVED"] as const) {
    const inactiveFacade = new UserActorResolutionFacade(
      new StaticAuthResolutionRepository([
        {
          userId: `user-${status}`,
          actorKind: "ADMIN",
          accountStatus: status,
          permissions: [],
        },
      ]),
    );
    await assert.rejects(
      () =>
        inactiveFacade.resolveByAuthLinkage({
          context: "ADMIN",
          authSubject: "auth0|inactive",
        }),
      new RegExp(`status ${status}`, "u"),
    );
  }
});

test("new account provisioning mutations resolve to dedicated permissions", () => {
  assert.equal(
    resolveAuthoritativePermissionForMutationIdentity("user.provision-account")
      .code,
    Permission.USER_PROVISION_ACCOUNT,
  );
  assert.equal(
    resolveAuthoritativePermissionForMutationIdentity(
      "user.auth-linkage.unlink",
    ).code,
    Permission.USER_AUTH_LINKAGE_UNLINK,
  );
  assert.equal(
    resolveAuthoritativePermissionForMutationIdentity(
      "user.password-setup.send",
    ).code,
    Permission.USER_PASSWORD_SETUP_SEND,
  );
  assert.equal(
    resolveAuthoritativePermissionForMutationIdentity("user.actor-kind.update")
      .code,
    Permission.USER_ACTOR_KIND_UPDATE,
  );
});

test("actorKind conversion requires reason and rejects self-update", async () => {
  const repo = new InMemoryUserRepository();
  const service = createService(repo, new MockAuth0Management());
  const now = Date.now();
  await repo.insert({
    id: "target-user",
    accountStatus: "ACTIVE",
    actorKind: "STAFF",
    authLinkage: {
      provider: "auth0",
      subject: "auth0|target",
      status: "LINKED",
    },
    profile: {
      displayName: "Target User",
      email: "target@example.test",
    },
    contextAccess: { contexts: ["ADMIN"] },
    preferences: {},
    createdAt: now,
    updatedAt: now,
    activatedAt: now,
    disabledAt: null,
    archivedAt: null,
  });

  await assert.rejects(
    () =>
      runService(() =>
        service.updateActorKind(createActor(ALL_PERMISSIONS), {
          userId: "target-user",
          actorKind: "ADMIN",
          reason: " ",
        }),
      ),
    /reason is required/u,
  );

  await assert.rejects(
    () =>
      runService(() =>
        service.updateActorKind(createActor(ALL_PERMISSIONS, "target-user"), {
          userId: "target-user",
          actorKind: "ADMIN",
          reason: "Promote for HR console access",
        }),
      ),
    /Cannot update your own account type/u,
  );
});

test("actorKind conversion STAFF to ADMIN audits and invalidates auth security", async () => {
  const repo = new InMemoryUserRepository();
  const audit = new RecordingAuditGuard();
  const bridge = new InlineMutationBridge();
  const service = createService(repo, new MockAuth0Management(), audit, bridge);
  const now = Date.now();
  await repo.insert({
    id: "target-user",
    accountStatus: "ACTIVE",
    actorKind: "STAFF",
    authLinkage: {
      provider: "auth0",
      subject: "auth0|target",
      status: "LINKED",
    },
    profile: {
      displayName: "Target User",
      email: "target@example.test",
    },
    contextAccess: { contexts: ["ADMIN"] },
    preferences: {},
    createdAt: now,
    updatedAt: now,
    activatedAt: now,
    disabledAt: null,
    archivedAt: null,
  });

  const result = await runService(() =>
    service.updateActorKind(createActor(ALL_PERMISSIONS), {
      userId: "target-user",
      actorKind: "ADMIN",
      reason: "Promote for HR console access",
    }),
  );

  assert.equal(result.user.actorKind, "ADMIN");
  assert.equal(bridge.authSecurityChanged, 1);
  const latestAuditRecord = audit.records[audit.records.length - 1];
  assert.equal(latestAuditRecord?.metadata.fromActorKind, "STAFF");
  assert.equal(latestAuditRecord?.metadata.toActorKind, "ADMIN");
  assert.equal(
    latestAuditRecord?.metadata.reason,
    "Promote for HR console access",
  );
});

test("actorKind conversion ADMIN to STAFF is blocked by active admin-console roles", async () => {
  const repo = new InMemoryUserRepository();
  const service = createService(
    repo,
    new MockAuth0Management(),
    new RecordingAuditGuard(),
    new InlineMutationBridge(),
    {},
    new AdminRoleCapabilityRepository(["HR_OPERATIONS"]),
  );
  const now = Date.now();
  await repo.insert({
    id: "target-user",
    accountStatus: "ACTIVE",
    actorKind: "ADMIN",
    authLinkage: {
      provider: "auth0",
      subject: "auth0|target",
      status: "LINKED",
    },
    profile: {
      displayName: "Target User",
      email: "target@example.test",
    },
    contextAccess: { contexts: ["ADMIN"] },
    preferences: {},
    createdAt: now,
    updatedAt: now,
    activatedAt: now,
    disabledAt: null,
    archivedAt: null,
  });

  await assert.rejects(
    () =>
      runService(() =>
        service.updateActorKind(createActor(ALL_PERMISSIONS), {
          userId: "target-user",
          actorKind: "STAFF",
          reason: "Move to self-service only",
        }),
      ),
    /active admin-console role assignments exist: HR_OPERATIONS/u,
  );
});

function createService(
  repo: InMemoryUserRepository,
  auth0: Auth0ManagementPort,
  audit: RecordingAuditGuard = new RecordingAuditGuard(),
  bridge: InlineMutationBridge = new InlineMutationBridge(),
  provisioningOptions: Partial<
    ConstructorParameters<typeof UserLifecycleService>[6]
  > = {},
  capabilityRepository: UserAdminCapabilityRepository = new PermissiveCapabilityRepository(),
): UserLifecycleService {
  return new UserLifecycleService(
    repo,
    capabilityRepository,
    audit as unknown as AuditGuard,
    bridge,
    { async invalidateAll() {} } as unknown as ActorSnapshotCacheInvalidator,
    auth0,
    {
      databaseConnection: "Username-Password-Authentication",
      passwordResetClientId: "client-id",
      passwordSetupDeliveryMode: "auth0_email",
      passwordSetupResultUrl: "https://app.example.test/password-ready",
      ...provisioningOptions,
    },
    {
      info() {},
      warn() {},
      error() {},
      fatal() {},
    },
  );
}

async function runService<T>(fn: () => Promise<T>): Promise<T> {
  return await bindTraceId(
    "trace-account-provisioning-test",
    async () => await runWithDomainEventCollector(fn),
  );
}

function createActor(permissions: readonly string[], id = "admin-user"): Actor {
  return new Actor({
    id,
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions,
    scopeGrants: {},
    isActive: true,
  });
}

function auth0Config(): ConstructorParameters<
  typeof Auth0ManagementHttpClient
>[0] {
  return {
    domain: "example.auth0.test",
    clientId: "client-id",
    clientSecret: "client-secret",
    databaseConnection: "Username-Password-Authentication",
    passwordResetClientId: "reset-client-id",
    passwordSetupDeliveryMode: "auth0_email",
  };
}

function auth0AxiosError(): unknown {
  return {
    isAxiosError: true,
    response: {
      status: 400,
      data: {
        access_token: "management-secret-token",
        client_secret: "client-secret",
        password: "TempSecret!123",
        ticket: "https://ticket.example.test/secret-ticket",
      },
    },
  };
}

function assertRedactedAuth0Error(error: unknown): boolean {
  assert.ok(error instanceof InfrastructureError);
  assert.equal(error.code, "AUTH0_MANAGEMENT_REQUEST_FAILED");
  assert.match(error.message, /HTTP 400/u);

  const serialized = `${error.message} ${JSON.stringify(error)}`;
  for (const sensitive of [
    "management-secret-token",
    "client-secret",
    "TempSecret!123",
    "ticket.example.test",
    "secret-ticket",
  ]) {
    assert.equal(serialized.includes(sensitive), false);
  }

  return true;
}

class MockAuth0Management implements Auth0ManagementPort {
  readonly usersById = new Map<string, Auth0ManagementUser>();
  readonly createUserCalls: Auth0CreateDatabaseUserInput[] = [];
  readonly ticketCalls: Auth0PasswordChangeTicketInput[] = [];
  readonly emailCalls: Auth0PasswordResetEmailInput[] = [];
  getUserCalls = 0;
  failCreate = false;
  failEmail = false;

  async findUserByEmail(email: string): Promise<Auth0ManagementUser | null> {
    const normalized = email.trim().toLowerCase();
    return (
      [...this.usersById.values()].find((user) => user.email === normalized) ??
      null
    );
  }

  async getUserById(userId: string): Promise<Auth0ManagementUser | null> {
    this.getUserCalls += 1;
    return this.usersById.get(userId) ?? null;
  }

  async createDatabaseUser(
    input: Auth0CreateDatabaseUserInput,
  ): Promise<Auth0ManagementUser> {
    if (this.failCreate) {
      throw new Error("Auth0 create failed");
    }

    this.createUserCalls.push(input);
    const id = `auth0|${input.email.split("@")[0]}`;
    const user = {
      id,
      email: input.email,
    };
    this.usersById.set(id, user);
    return user;
  }

  async createPasswordChangeTicket(
    input: Auth0PasswordChangeTicketInput,
  ): Promise<{ readonly ticketCreated: true; readonly ticketUrl: string }> {
    this.ticketCalls.push(input);
    return {
      ticketCreated: true,
      ticketUrl: "https://ticket.example.test/secret-ticket",
    };
  }

  async sendPasswordResetEmail(
    input: Auth0PasswordResetEmailInput,
  ): Promise<void> {
    if (this.failEmail) {
      throw new Error("Auth0 email failed");
    }

    this.emailCalls.push(input);
  }
}

class InMemoryUserRepository implements UserMutationRepository {
  readonly records: UserRecord[] = [];

  async insert(input: CreateUserInput): Promise<UserRecord> {
    const record: UserRecord = {
      id: input.id,
      accountStatus: input.accountStatus,
      actorKind: input.actorKind,
      authLinkage: input.authLinkage,
      profile: input.profile,
      contextAccess: input.contextAccess,
      preferences: input.preferences,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      activatedAt: input.activatedAt,
      disabledAt: input.disabledAt,
      archivedAt: input.archivedAt,
    };
    this.records.push(record);
    return record;
  }

  async findById(userId: string): Promise<UserRecord | null> {
    return this.records.find((record) => record.id === userId) ?? null;
  }

  async findByAuthSubject(authSubject: string): Promise<UserRecord | null> {
    return (
      this.records.find(
        (record) =>
          record.authLinkage.subject === authSubject &&
          (record.authLinkage.status ?? "LINKED") === "LINKED",
      ) ?? null
    );
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const normalized = email.trim().toLowerCase();
    return (
      this.records.find(
        (record) => record.profile.email?.toLowerCase() === normalized,
      ) ?? null
    );
  }

  async updateProfile(
    input: UpdateUserProfileInput,
  ): Promise<UserRecord | null> {
    const current = await this.findById(input.userId);
    if (!current) {
      return null;
    }

    const updated = {
      ...current,
      profile: {
        ...current.profile,
        displayName: input.displayName ?? current.profile.displayName,
        email: input.email ?? current.profile.email,
        phone: input.phone ?? current.profile.phone,
      },
      preferences: {
        ...current.preferences,
        locale: input.locale ?? current.preferences.locale,
        timezone: input.timezone ?? current.preferences.timezone,
      },
      updatedAt: input.updatedAt,
    };
    this.replace(updated);
    return updated;
  }

  async updatePreferences(
    input: UpdateUserPreferencesInput,
  ): Promise<UserRecord | null> {
    const current = await this.findById(input.userId);
    if (!current || current.accountStatus === "ARCHIVED") {
      return null;
    }

    const updated = {
      ...current,
      preferences: {
        ...current.preferences,
        locale: input.locale ?? current.preferences.locale,
        timezone: input.timezone ?? current.preferences.timezone,
      },
      updatedAt: input.updatedAt,
    };
    this.replace(updated);
    return updated;
  }

  async transitionLifecycle(
    input: TransitionUserLifecycleInput,
  ): Promise<UserRecord | null> {
    const current = await this.findById(input.userId);
    if (!current || !input.fromStates.includes(current.accountStatus)) {
      return null;
    }

    const updated = {
      ...current,
      accountStatus: input.toState,
      updatedAt: input.changedAt,
    };
    this.replace(updated);
    return updated;
  }

  async setAuthLinkage(
    input: SetUserAuthLinkageInput,
  ): Promise<UserRecord | null> {
    const current = await this.findById(input.userId);
    if (!current) {
      return null;
    }

    const updated = {
      ...current,
      accountStatus: input.accountStatus ?? current.accountStatus,
      authLinkage: {
        provider: input.provider,
        subject: input.subject,
        status: input.status ?? "LINKED",
      },
      updatedAt: input.updatedAt,
    };
    this.replace(updated);
    return updated;
  }

  async updateActorKind(input: {
    readonly userId: string;
    readonly actorKind: "ADMIN" | "STAFF";
    readonly updatedAt: number;
  }): Promise<UserRecord | null> {
    const current = await this.findById(input.userId);
    if (!current) {
      return null;
    }

    const updated = {
      ...current,
      actorKind: input.actorKind,
      updatedAt: input.updatedAt,
    };
    this.replace(updated);
    return updated;
  }

  private replace(record: UserRecord): void {
    const index = this.records.findIndex((item) => item.id === record.id);
    assert.notEqual(index, -1);
    this.records[index] = record;
  }
}

class PermissiveCapabilityRepository implements UserAdminCapabilityRepository {
  async listActiveUserIdsByPermission(
    permissionCodes: readonly string[],
  ): Promise<Readonly<Record<string, readonly string[]>>> {
    return Object.fromEntries(
      permissionCodes.map((permission) => [
        permission,
        ["admin-user", "target-user"],
      ]),
    );
  }

  async hasActiveRoleAssignments(): Promise<boolean> {
    return false;
  }

  async listActiveAdminConsoleRoleCodesByUserId(): Promise<readonly string[]> {
    return [];
  }

  async listActiveDelegationCeilingsByUserId(): Promise<
    readonly "PRIVILEGED"[]
  > {
    return ["PRIVILEGED"];
  }

  async listActiveUserIdsWithGovernanceRecoverySurface(): Promise<
    readonly string[]
  > {
    return ["admin-user", "target-user"];
  }
}

class AdminRoleCapabilityRepository extends PermissiveCapabilityRepository {
  constructor(private readonly roleCodes: readonly string[]) {
    super();
  }

  override async listActiveAdminConsoleRoleCodesByUserId(): Promise<
    readonly string[]
  > {
    return this.roleCodes;
  }
}

class InlineMutationBridge implements AuthoritativeAdminMutationBridge {
  authSecurityChanged = 0;

  async execute<T>(
    _params: Parameters<AuthoritativeAdminMutationBridge["execute"]>[0],
    mutate: Parameters<AuthoritativeAdminMutationBridge["execute"]>[1],
  ): Promise<T> {
    return mutate({} as ClientSession, {
      markAuthSecurityTruthChanged: () => {
        this.authSecurityChanged += 1;
      },
      markExplicitNoOpSuccess() {},
    }) as Promise<T>;
  }
}

class RecordingAuditGuard {
  readonly records: Array<{
    readonly targetId: string;
    readonly metadata: Readonly<Record<string, unknown>>;
  }> = [];

  async record(
    _actor: Actor,
    _permission: unknown,
    targetId: string,
    metadata: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    this.records.push({ targetId, metadata });
  }
}

class StaticAuthResolutionRepository implements UserAuthResolutionRepository {
  constructor(
    private readonly candidates: Awaited<
      ReturnType<UserAuthResolutionRepository["findByAuthSubject"]>
    >,
  ) {}

  async findByAuthSubject(): Promise<
    Awaited<ReturnType<UserAuthResolutionRepository["findByAuthSubject"]>>
  > {
    return this.candidates;
  }
}

class RecordingUserReadRepository implements UserReadRepository {
  readonly listInputs: ListUserReadInput[] = [];

  async listUsers(input: ListUserReadInput): Promise<ListUserReadResult> {
    this.listInputs.push(input);
    return {
      items: [],
    };
  }

  async getUserDetail(): Promise<UserDetailView | null> {
    return null;
  }
}

function userRecord(params: {
  readonly id?: string;
  readonly email?: string;
  readonly authSubject?: string;
  readonly authStatus?: "LINKED" | "UNLINKED";
  readonly accountStatus?: UserAccountStatus;
}): UserRecord {
  const now = Date.now();
  return {
    id: params.id ?? cryptoRandomId(),
    accountStatus: params.accountStatus ?? "PENDING",
    actorKind: "ADMIN",
    authLinkage: {
      provider: "auth0",
      subject: params.authSubject ?? `auth0|${params.id ?? "user"}`,
      status: params.authStatus ?? "LINKED",
    },
    profile: {
      displayName: params.id ?? "User",
      email: params.email,
    },
    contextAccess: {
      contexts: ["ADMIN"],
    },
    preferences: {},
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    disabledAt: null,
    archivedAt: null,
  };
}

let idCounter = 0;
function cryptoRandomId(): string {
  idCounter += 1;
  return `user-${idCounter}`;
}
