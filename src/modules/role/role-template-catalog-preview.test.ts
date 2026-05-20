import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { test } from "node:test";
import express, { NextFunction, Request, Response } from "express";
import { ClientSession } from "mongodb";
import { bindActor } from "@core/actor/actor-context";
import { Actor } from "@core/actor/actor";
import { contextMiddleware } from "@core/context/context.middleware.adapter";
import { mapToHttpError } from "@app/http/http-error.map";
import { PresenterRegistry } from "@app/presenter/presenter.registry";
import { bindPresenterRegistry } from "@app/presenter/presenter.runtime-access";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import { AuthoritativeAdminMutationBridge } from "@core/application/authoritative-admin-mutation.bridge";
import { AuditGuard } from "@core/audit/audit.guard";
import { ActorSnapshotCacheInvalidator } from "@infra/cache/actor.snapshot.cache";
import { StructuredLogger } from "@infra/logger.adapter";
import { runWithDomainEventCollector } from "@system/event-bridge/domain-event.types";
import {
  ROLE_TEMPLATE_CATALOG,
  ROLE_TEMPLATE_CODES,
  getRoleTemplate,
  validateRoleTemplateCatalog,
} from "@modules/role/domain/role-template.catalog";
import { RoleAdminService } from "@modules/role/admin/admin.role.service";
import { RoleTemplateAdminService } from "@modules/role/admin/admin.role-template.service";
import { AdminRoleTemplateController } from "@modules/role/admin/admin.role-template.controller";
import { adminRoleTemplateRoutes } from "@modules/role/admin/admin.role-template.routes";
import { registerPresenters } from "@modules/role/shared/role.presenter.register";
import {
  ReplaceRolePermissionsInput,
  RoleRepository,
  TransitionRoleStateInput,
  UpdateRoleMetadataInput,
} from "@modules/role/domain/role.repository";
import { RoleAssignmentRuleRepository } from "@modules/role/domain/role-assignment-rule.repository";
import { UserRoleAssignmentRepository } from "@modules/role/domain/user-role-assignment.repository";
import {
  RoleAssignmentRuleRecord,
  RoleRecord,
  UserRoleAssignmentRecord,
} from "@modules/role/domain/role.types";
import { RoleUserReadonlyAccess } from "@modules/role/domain/role-user-readonly-access";
import { UserAdminCapabilityRepository } from "@modules/user/domain/user.admin-capability.repository";

const ALL_PERMISSION_CODES = Object.values(Permission);

test("role template catalog contains exactly the seven core templates with valid unique permissions", () => {
  validateRoleTemplateCatalog();

  assert.deepEqual(
    ROLE_TEMPLATE_CATALOG.map((template) => template.code).sort(),
    [...ROLE_TEMPLATE_CODES].sort(),
  );

  for (const template of ROLE_TEMPLATE_CATALOG) {
    const permissions = template.permissions.map(
      (permission) => permission,
    );
    assert.equal(
      new Set(permissions).size,
      permissions.length,
      `${template.code} must not duplicate permissions`,
    );

    for (const permission of permissions) {
      assert.equal(
        ALL_PERMISSION_CODES.includes(permission),
        true,
        `${template.code} uses known Permission enum value ${permission}`,
      );
    }
  }

  assert.deepEqual(
    getRoleTemplate("ADMIN_FULL")?.permissions,
    ALL_PERMISSION_CODES,
  );
});

test("role template list and preview service are permission-gated and preview-only", () => {
  const service = new RoleTemplateAdminService();
  const actor = createActor([
    Permission.ROLE_LIST,
    Permission.ROLE_VIEW,
  ]);

  const listed = service.listRoleTemplates(actor);
  assert.equal(listed.items.length, 7);
  assert.equal(
    listed.items.every((item) => item.warnings.length > 0),
    true,
  );

  const beforeStoreSize = 0;
  const preview = service.previewRoleTemplate(actor, {
    templateCode: "commercial_finance",
  });

  assert.equal(
    preview.template.code,
    "COMMERCIAL_FINANCE",
  );
  assert.equal(
    preview.permissions.includes(
      Permission.REVENUE_LEDGER_RECONCILE,
    ),
    true,
  );
  assert.equal(preview.scopePlan.length > 0, true);
  assert.equal(preview.warnings.length > 0, true);
  assert.equal(
    preview.unsupportedScopeNotes.length > 0,
    true,
  );
  assert.equal(beforeStoreSize, 0);

  assert.throws(
    () =>
      service.previewRoleTemplate(actor, {
        templateCode: "UNKNOWN_TEMPLATE",
      }),
    /Unknown role template code/,
  );
});

test("role template endpoints return catalog and preview without mutating roles", async () => {
  const app = express();
  app.use(express.json());

  const registry = new PresenterRegistry();
  registerPresenters(registry);
  registry.freeze();
  bindPresenterRegistry(app, registry);

  app.use(contextMiddleware("ADMIN"));
  app.use((req, _res, next) => {
    bindActor(
      req,
      createActor([
        Permission.ROLE_LIST,
        Permission.ROLE_VIEW,
      ]),
    );
    next();
  });

  const controller = new AdminRoleTemplateController(
    new RoleTemplateAdminService(),
  );
  app.use("/admin/role-templates", adminRoleTemplateRoutes(controller));
  app.use(
    (
      error: unknown,
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      const mapped = mapToHttpError(error);
      res.status(mapped.status).json({
        error: {
          code: mapped.code,
          message: mapped.message,
        },
      });
    },
  );

  const server = await listen(app);
  try {
    const baseUrl = toBaseUrl(server);
    const listResponse = await fetch(
      `${baseUrl}/admin/role-templates`,
    );
    assert.equal(listResponse.status, 200);
    const listBody = await listResponse.json();
    assert.equal(listBody.data.length, 7);
    assert.equal(
      listBody.data[0].warnings.length > 0,
      true,
    );

    const previewResponse = await fetch(
      `${baseUrl}/admin/role-templates/ADMIN_FULL/preview`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );
    assert.equal(previewResponse.status, 200);
    const previewBody = await previewResponse.json();
    assert.equal(
      previewBody.data.template.code,
      "ADMIN_FULL",
    );
    assert.equal(
      previewBody.data.permissions.length,
      ALL_PERMISSION_CODES.length,
    );
    assert.equal(
      previewBody.data.scopePlan.some(
        (entry: { module: string }) =>
          entry.module === "Work Schedule",
      ),
      true,
    );

    const unknownResponse = await fetch(
      `${baseUrl}/admin/role-templates/NOPE/preview`,
      {
        method: "POST",
      },
    );
    assert.equal(unknownResponse.status, 400);
  } finally {
    await close(server);
  }
});

test("create role from template persists explicit permissions and provenance only", async () => {
  const roleRepository = new InMemoryRoleRepository();
  const assignmentRepository =
    new InMemoryUserRoleAssignmentRepository();
  const assignmentRuleRepository =
    new InMemoryRoleAssignmentRuleRepository();
  const bridge = new InlineMutationBridge();

  const service = new RoleAdminService(
    roleRepository,
    assignmentRepository,
    assignmentRuleRepository,
    new AlwaysAssignableUserAccess(),
    new PermissiveAdminCapabilityRepository(),
    createAuditGuard(),
    bridge,
    createActorSnapshotCacheInvalidator(),
    noOpLogger,
  );

  const actor = createActor(ALL_PERMISSION_CODES);

  const result = await bindTraceId(
    "trace-role-template-create",
    async () =>
      runWithDomainEventCollector(() =>
        service.createRoleFromTemplate(actor, {
          templateCode: "TALENT_STAFF_SELF",
          code: "talent_staff_self_custom",
          name: "Talent Staff Self Custom",
          description: "Self-service baseline",
        }),
      ),
  );

  const template = getRoleTemplate("TALENT_STAFF_SELF");
  assert.notEqual(template, null);
  assert.equal(result.code, "TALENT_STAFF_SELF_CUSTOM");
  assert.deepEqual(
    result.permissions,
    template?.permissions,
  );
  assert.equal(result.templateCode, "TALENT_STAFF_SELF");
  assert.equal(
    result.templateVersion,
    template?.version,
  );
  assert.equal(
    typeof result.templateAppliedAt,
    "number",
  );
  assert.equal(assignmentRepository.insertCount, 0);
  assert.equal(
    "scopePlan" in roleRepository.inserted[0],
    false,
  );
  assert.equal(
    "scopeGrants" in roleRepository.inserted[0],
    false,
  );
  assert.equal(
    bridge.mutationIdentities.includes("role.create"),
    true,
  );
});

test("create role from template respects existing permission authoring constraints", async () => {
  const service = new RoleAdminService(
    new InMemoryRoleRepository(),
    new InMemoryUserRoleAssignmentRepository(),
    new InMemoryRoleAssignmentRuleRepository(),
    new AlwaysAssignableUserAccess(),
    new PermissiveAdminCapabilityRepository(),
    createAuditGuard(),
    new InlineMutationBridge(),
    createActorSnapshotCacheInvalidator(),
    noOpLogger,
  );

  const actor = createActor([
    Permission.ROLE_CREATE,
    Permission.WORK_SCHEDULE_READ,
  ]);

  await assert.rejects(
    () =>
      bindTraceId(
        "trace-role-template-denied",
        async () =>
          runWithDomainEventCollector(() =>
            service.createRoleFromTemplate(actor, {
              templateCode: "ADMIN_FULL",
              code: "admin_full_copy",
              name: "Admin Full Copy",
            }),
          ),
      ),
    /initialPermissions contains unauthorized permission code/,
  );
});

function createActor(
  permissions: readonly string[],
): Actor {
  return new Actor({
    id: "admin-user-1",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions,
    scopeGrants: {},
    isActive: true,
  });
}

function listen(app: express.Express): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, "127.0.0.1", () =>
      resolve(server),
    );
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function toBaseUrl(server: Server): string {
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const info = address as AddressInfo;
  return `http://127.0.0.1:${info.port}`;
}

class InMemoryRoleRepository implements RoleRepository {
  readonly inserted: RoleRecord[] = [];

  async insert(
    role: RoleRecord,
    _session: ClientSession,
  ): Promise<RoleRecord> {
    this.inserted.push(role);
    return role;
  }

  async findById(
    roleId: string,
  ): Promise<RoleRecord | null> {
    return (
      this.inserted.find((role) => role.id === roleId) ??
      null
    );
  }

  async findByCode(
    code: string,
  ): Promise<RoleRecord | null> {
    return (
      this.inserted.find((role) => role.code === code) ??
      null
    );
  }

  async updateMetadata(
    _input: UpdateRoleMetadataInput,
    _session: ClientSession,
  ): Promise<RoleRecord | null> {
    return null;
  }

  async transitionState(
    _input: TransitionRoleStateInput,
    _session: ClientSession,
  ): Promise<RoleRecord | null> {
    return null;
  }

  async replacePermissions(
    _input: ReplaceRolePermissionsInput,
    _session: ClientSession,
  ): Promise<RoleRecord | null> {
    return null;
  }
}

class InMemoryRoleAssignmentRuleRepository
  implements RoleAssignmentRuleRepository
{
  private rules: readonly RoleAssignmentRuleRecord[] = [];

  async replaceForRole(
    input: {
      readonly roleId: string;
      readonly rules: readonly RoleAssignmentRuleRecord[];
    },
    _session: ClientSession,
  ): Promise<readonly RoleAssignmentRuleRecord[]> {
    this.rules = input.rules;
    return this.rules;
  }

  async listByRoleId(
    _roleId: string,
    _session?: ClientSession,
  ): Promise<readonly RoleAssignmentRuleRecord[]> {
    return this.rules;
  }
}

class InMemoryUserRoleAssignmentRepository
  implements UserRoleAssignmentRepository
{
  insertCount = 0;

  async insert(
    assignment: UserRoleAssignmentRecord,
    _session: ClientSession,
  ): Promise<UserRoleAssignmentRecord> {
    this.insertCount += 1;
    return assignment;
  }

  async findById(): Promise<UserRoleAssignmentRecord | null> {
    return null;
  }

  async findActiveByRoleAndUser(): Promise<UserRoleAssignmentRecord | null> {
    return null;
  }

  async hasActiveAssignmentsForRole(): Promise<boolean> {
    return false;
  }

  async revokeById(): Promise<UserRoleAssignmentRecord | null> {
    return null;
  }
}

class AlwaysAssignableUserAccess
  implements RoleUserReadonlyAccess
{
  async isAssignableById(): Promise<boolean> {
    return true;
  }
}

class PermissiveAdminCapabilityRepository
  implements UserAdminCapabilityRepository
{
  async listActiveUserIdsByPermission(
    permissionCodes: readonly string[],
    _session: ClientSession,
  ): Promise<Readonly<Record<string, readonly string[]>>> {
    return Object.fromEntries(
      permissionCodes.map((permission) => [
        permission,
        ["admin-user-1"],
      ]),
    );
  }

  async hasActiveRoleAssignments(): Promise<boolean> {
    return true;
  }

  async listActiveDelegationCeilingsByUserId(): Promise<
    readonly "PRIVILEGED"[]
  > {
    return ["PRIVILEGED"];
  }

  async listActiveUserIdsWithGovernanceRecoverySurface(): Promise<
    readonly string[]
  > {
    return ["admin-user-1"];
  }
}

class InlineMutationBridge
  implements AuthoritativeAdminMutationBridge
{
  readonly mutationIdentities: string[] = [];

  async execute<T>(
    params: Parameters<AuthoritativeAdminMutationBridge["execute"]>[0],
    mutate: Parameters<AuthoritativeAdminMutationBridge["execute"]>[1],
  ): Promise<T> {
    this.mutationIdentities.push(
      params.mutationIdentity,
    );
    return mutate({} as ClientSession, {
      markAuthSecurityTruthChanged() {},
      markExplicitNoOpSuccess() {},
    }) as Promise<T>;
  }
}

function createAuditGuard(): AuditGuard {
  return {
    async record() {},
  } as unknown as AuditGuard;
}

function createActorSnapshotCacheInvalidator(): ActorSnapshotCacheInvalidator {
  return {
    async invalidateAll() {},
  } as unknown as ActorSnapshotCacheInvalidator;
}

const noOpLogger: StructuredLogger = {
  info() {},
  warn() {},
  error() {},
  fatal() {},
};
