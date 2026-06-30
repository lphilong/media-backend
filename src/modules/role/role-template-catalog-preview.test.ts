import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { test } from "node:test";
import express, { NextFunction, Request, Response } from "express";
import { ClientSession, MongoServerError } from "mongodb";
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
import { BusinessCodeSequenceRepository } from "@core/business-code/business-code-sequence.repository";
import { ActorSnapshotCacheInvalidator } from "@infra/cache/actor.snapshot.cache";
import { StructuredLogger } from "@infra/logger.adapter";
import { runWithDomainEventCollector } from "@system/event-bridge/domain-event.types";
import {
  LEGACY_ROLE_TEMPLATE_CODES,
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
import {
  RoleAssignmentConflictError,
  RoleConflictError,
  RoleValidationError,
} from "@modules/role/domain/role.errors";
import { UserAdminCapabilityRepository } from "@modules/user/domain/user.admin-capability.repository";

const ALL_PERMISSION_CODES = Object.values(Permission);

test("role template catalog contains target templates only with valid unique permissions", () => {
  validateRoleTemplateCatalog();

  assert.deepEqual(
    ROLE_TEMPLATE_CATALOG.map((template) => template.code).sort(),
    [...ROLE_TEMPLATE_CODES].sort(),
  );

  const targetCodes = new Set(ROLE_TEMPLATE_CATALOG.map((item) => item.code));
  for (const legacyCode of LEGACY_ROLE_TEMPLATE_CODES) {
    assert.equal(targetCodes.has(legacyCode as never), false);
    assert.equal(getRoleTemplate(legacyCode), null);
  }

  for (const template of ROLE_TEMPLATE_CATALOG) {
    assert.equal(typeof template.recommendedAccountContext, "string");
    const permissions = template.permissions.map((permission) => permission);
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

  const owner = getRoleTemplate("OWNER_ADMIN");
  assert.notEqual(owner, null);
  assert.deepEqual(owner?.permissions, ALL_PERMISSION_CODES);
});

test("target role templates keep contract obligation evidence mutation authority admin-global first", () => {
  const obligationCapabilities = [
    Permission.CONTRACT_OBLIGATION_READ,
    Permission.CONTRACT_OBLIGATION_MANAGE_DRAFT,
    Permission.CONTRACT_OBLIGATION_DELIVER,
    Permission.CONTRACT_OBLIGATION_REVIEW,
    Permission.CONTRACT_OBLIGATION_MANAGE_LIFECYCLE,
    Permission.CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_READ,
    Permission.CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK,
    Permission.CONTRACT_OBLIGATION_EVENT_EVIDENCE_REMOVE,
  ];
  const obligationMutationCapabilities =
    obligationCapabilities.filter(
      (permission) =>
        permission !== Permission.CONTRACT_OBLIGATION_READ &&
        permission !==
          Permission.CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_READ,
    );

  const owner = getRoleTemplate("OWNER_ADMIN");
  assert.notEqual(owner, null);
  for (const permission of obligationCapabilities) {
    assert.equal(
      owner?.permissions.includes(permission),
      true,
      `OWNER_ADMIN must include ${permission}`,
    );
  }

  const manager = getRoleTemplate("TALENT_GROUP_MANAGER");
  const self = getRoleTemplate("STAFF_CONSOLE_USER");
  const auditor = getRoleTemplate("VIEWER_AUDITOR");
  for (const template of [manager, self, auditor]) {
    assert.notEqual(template, null);
    for (const permission of obligationMutationCapabilities) {
      assert.equal(
        template?.permissions.includes(permission),
        false,
        `${template?.code} must not include ${permission}`,
      );
    }
  }

  const commercial = getRoleTemplate("COMMERCIAL_CONTRACT_OPS");
  assert.notEqual(commercial, null);
  assert.equal(
    commercial?.permissions.includes(
      Permission.CONTRACT_OBLIGATION_READ,
    ),
    true,
  );
  assert.equal(
    commercial?.permissions.includes(
      Permission.CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_READ,
    ),
    true,
  );
  assert.equal(
    commercial?.permissions.includes(
      Permission.CONTRACT_OBLIGATION_MANAGE_DRAFT,
    ),
    true,
  );
  assert.equal(
    commercial?.permissions.includes(
      Permission.CONTRACT_OBLIGATION_REVIEW,
    ),
    false,
  );
  assert.equal(
    commercial?.permissions.includes(
      Permission.CONTRACT_OBLIGATION_MANAGE_LIFECYCLE,
    ),
    true,
  );
  assert.equal(
    commercial?.permissions.includes(
      Permission.CONTRACT_OBLIGATION_DELIVER,
    ),
    true,
  );
  assert.equal(
    commercial?.permissions.includes(
      Permission.CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK,
    ),
    true,
  );
  assert.equal(
    commercial?.permissions.includes(
      Permission.CONTRACT_OBLIGATION_EVENT_EVIDENCE_REMOVE,
    ),
    true,
  );

  assert.equal(
    auditor?.permissions.includes(
      Permission.CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_READ,
    ),
    true,
  );

  const externalTalentTemplates = ROLE_TEMPLATE_CATALOG.filter(
    (template) =>
      template.category === "EXTERNAL" ||
      template.code.includes("EXTERNAL"),
  );
  assert.equal(externalTalentTemplates.length, 0);
});

test("target role templates align KPI V2 permissions with runtime scope recommendations", () => {
  const admin = getRoleTemplate("OWNER_ADMIN");
  const hr = getRoleTemplate("HR_OPERATIONS");
  const manager = getRoleTemplate("TALENT_GROUP_MANAGER");
  const production = getRoleTemplate("PRODUCTION_OPS");
  const finance = getRoleTemplate("REVENUE_FINANCE_OPS");
  const self = getRoleTemplate("STAFF_CONSOLE_USER");
  const auditor = getRoleTemplate("VIEWER_AUDITOR");

  assert.equal(admin?.recommendedAccountContext, "ADMIN_CONSOLE");
  assert.deepEqual(admin?.recommendedScopeGrants.kpi, ["global"]);
  assert.equal(admin?.permissions.includes(Permission.KPI_FINALIZE), true);

  assert.equal(hr?.recommendedAccountContext, "ADMIN_CONSOLE");
  assert.equal(
    hr?.permissions.includes(Permission.USER_PROVISION_ACCOUNT),
    true,
  );
  assert.equal(
    hr?.permissions.includes(Permission.USER_PASSWORD_SETUP_SEND),
    true,
  );
  assert.equal(
    hr?.permissions.includes(Permission.USER_AUTH_LINKAGE_UNLINK),
    false,
  );
  assert.equal(hr?.permissions.includes(Permission.USER_DISABLE), false);
  assert.equal(hr?.permissions.includes(Permission.USER_ARCHIVE), false);
  assert.equal(hr?.permissions.includes(Permission.ROLE_ASSIGN_TO_USER), false);
  assert.deepEqual(hr?.recommendedScopeGrants.kpi, ["global"]);
  assert.equal(hr?.permissions.includes(Permission.KPI_READ), true);
  assert.equal(hr?.permissions.includes(Permission.KPI_ENTER_ACTUAL), false);
  assert.equal(
    hr?.permissions.includes(Permission.STUDIO_RESOURCE_LOOKUP),
    false,
  );
  assert.equal(
    hr?.permissions.includes(Permission.STUDIO_RESOURCE_READ),
    false,
  );

  assert.equal(manager?.recommendedAccountContext, "MANAGER_CONSOLE");
  assert.deepEqual(manager?.recommendedScopeGrants.workSchedule, [
    "team",
  ]);
  assert.equal(
    manager?.permissions.includes(Permission.WORK_SCHEDULE_READ),
    true,
  );
  assert.equal(
    manager?.permissions.includes(Permission.WORK_SCHEDULE_CREATE),
    false,
  );
  assert.equal(
    manager?.permissions.includes(Permission.WORK_SCHEDULE_UPDATE),
    false,
  );
  assert.equal(
    manager?.permissions.includes(Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE),
    false,
  );
  assert.deepEqual(manager?.recommendedScopeGrants.kpi, ["managedGroup"]);
  assert.deepEqual(manager?.recommendedScopeGrants.eventAssignment, [
    "managedGroup",
  ]);
  assert.equal(
    manager?.recommendedScopeGrants.eventAssignment?.includes("global"),
    false,
  );
  assert.equal(manager?.permissions.includes(Permission.KPI_READ), true);
  assert.equal(
    manager?.permissions.includes(Permission.KPI_READ_PROGRESS),
    true,
  );
  assert.equal(
    manager?.permissions.includes(Permission.KPI_ENTER_ACTUAL),
    true,
  );
  assert.equal(
    manager?.permissions.includes(Permission.KPI_CORRECT_ACTUAL),
    true,
  );
  assert.equal(manager?.permissions.includes(Permission.KPI_PUBLISH), false);

  assert.equal(production?.recommendedAccountContext, "ADMIN_CONSOLE");
  assert.equal(production?.recommendedScopeGrants.kpi, undefined);
  assert.deepEqual(production?.recommendedScopeGrants.workSchedule, ["global"]);
  assert.deepEqual(production?.recommendedScopeGrants.eventAssignment, [
    "global",
  ]);
  assert.equal(production?.permissions.includes(Permission.KPI_READ), false);
  assert.equal(
    production?.permissions.includes(Permission.ORG_UNIT_LOOKUP),
    true,
  );
  assert.equal(
    production?.permissions.includes(Permission.ORG_UNIT_READ),
    false,
  );
  assert.equal(
    production?.permissions.includes(Permission.TALENT_LOOKUP),
    true,
  );
  assert.equal(
    production?.permissions.includes(Permission.EMPLOYMENT_PROFILE_READ),
    false,
  );

  assert.equal(finance?.recommendedAccountContext, "ADMIN_CONSOLE");
  assert.equal(finance?.recommendedScopeGrants.kpi, undefined);
  assert.equal(finance?.recommendedScopeGrants.eventAssignment, undefined);
  assert.equal(finance?.permissions.includes(Permission.EVENT_LOOKUP), false);
  assert.equal(finance?.permissions.includes(Permission.EVENT_READ), false);
  assert.equal(finance?.permissions.includes(Permission.KPI_READ), false);
  assert.equal(
    finance?.permissions.includes(Permission.KPI_READ_PROGRESS),
    false,
  );
  assert.equal(
    finance?.permissions.includes(Permission.KPI_ENTER_ACTUAL),
    false,
  );
  assert.equal(finance?.permissions.includes(Permission.KPI_FINALIZE), false);
  assert.equal(finance?.permissions.includes(Permission.TALENT_LOOKUP), false);
  assert.equal(finance?.permissions.includes(Permission.TALENT_READ), false);
  assert.equal(
    finance?.permissions.includes(Permission.PLATFORM_ACCOUNT_LOOKUP),
    false,
  );
  assert.equal(
    finance?.permissions.includes(Permission.PLATFORM_ACCOUNT_READ),
    false,
  );
  assert.equal(
    finance?.permissions.includes(Permission.REVENUE_LEDGER_CREATE),
    true,
  );
  assert.equal(
    finance?.permissions.includes(
      Permission.REVENUE_LEDGER_PLATFORM_EARNING_APPROVE,
    ),
    false,
  );

  assert.equal(self?.recommendedAccountContext, "STAFF_CONSOLE");
  assert.deepEqual(self?.recommendedScopeGrants.kpi, ["self"]);
  assert.equal(self?.recommendedScopeGrants.eventAssignment, undefined);
  assert.equal(self?.permissions.includes(Permission.KPI_READ_PROGRESS), true);
  assert.equal(self?.permissions.includes(Permission.KPI_READ), false);

  assert.deepEqual(auditor?.recommendedScopeGrants.kpi, ["global"]);
  assert.deepEqual(auditor?.recommendedScopeGrants.eventAssignment, ["global"]);
  assert.equal(auditor?.permissions.includes(Permission.KPI_READ), true);
  assert.equal(
    auditor?.permissions.includes(Permission.KPI_READ_PROGRESS),
    true,
  );
  assert.equal(
    auditor?.permissions.includes(Permission.KPI_CORRECT_ACTUAL),
    false,
  );
  assert.equal(auditor?.permissions.includes(Permission.EVENT_READ), true);
  assert.equal(auditor?.permissions.includes(Permission.EVENT_UPDATE), false);
  assert.equal(
    auditor?.permissions.includes(Permission.EMPLOYMENT_TERMS_READ_SENSITIVE),
    false,
  );
});

test("role template list and preview service are permission-gated and preview-only", () => {
  const service = new RoleTemplateAdminService();
  const actor = createActor([Permission.ROLE_LIST, Permission.ROLE_VIEW]);

  const listed = service.listRoleTemplates(actor);
  assert.equal(listed.items.length, ROLE_TEMPLATE_CODES.length);
  assert.equal(
    listed.items.every((item) => item.recommendedAccountContext !== undefined),
    true,
  );
  for (const legacyCode of LEGACY_ROLE_TEMPLATE_CODES) {
    assert.equal(
      listed.items.some((item) => String(item.code) === legacyCode),
      false,
    );
  }
  assert.equal(
    listed.items.every((item) => item.warnings.length > 0),
    true,
  );

  const beforeStoreSize = 0;
  const preview = service.previewRoleTemplate(actor, {
    templateCode: "revenue_finance_ops",
  });

  assert.equal(preview.template.code, "REVENUE_FINANCE_OPS");
  assert.equal(
    preview.permissions.includes(Permission.REVENUE_LEDGER_CREATE),
    true,
  );
  assert.equal(preview.template.recommendedAccountContext, "ADMIN_CONSOLE");
  assert.equal(preview.scopePlan.length > 0, true);
  assert.equal(preview.warnings.length > 0, true);
  assert.equal(beforeStoreSize, 0);

  for (const legacyCode of LEGACY_ROLE_TEMPLATE_CODES) {
    assert.throws(
      () =>
        service.previewRoleTemplate(actor, {
          templateCode: legacyCode,
        }),
      /Unknown role template code/,
    );
  }

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
    bindActor(req, createActor([Permission.ROLE_LIST, Permission.ROLE_VIEW]));
    next();
  });

  const controller = new AdminRoleTemplateController(
    new RoleTemplateAdminService(),
  );
  app.use("/admin/role-templates", adminRoleTemplateRoutes(controller));
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
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
    const listResponse = await fetch(`${baseUrl}/admin/role-templates`);
    assert.equal(listResponse.status, 200);
    const listBody = await listResponse.json();
    assert.equal(listBody.data.length, ROLE_TEMPLATE_CODES.length);
    assert.equal(listBody.data[0].warnings.length > 0, true);
    assert.equal(
      listBody.data.every(
        (item: { recommendedAccountContext?: string }) =>
          typeof item.recommendedAccountContext === "string",
      ),
      true,
    );
    for (const legacyCode of LEGACY_ROLE_TEMPLATE_CODES) {
      assert.equal(
        listBody.data.some(
          (item: { code: string }) => item.code === legacyCode,
        ),
        false,
      );
    }

    const previewResponse = await fetch(
      `${baseUrl}/admin/role-templates/OWNER_ADMIN/preview`,
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
    assert.equal(previewBody.data.template.code, "OWNER_ADMIN");
    assert.equal(
      previewBody.data.template.recommendedAccountContext,
      "ADMIN_CONSOLE",
    );
    assert.equal(
      previewBody.data.permissions.length,
      ALL_PERMISSION_CODES.length,
    );
    assert.equal(
      previewBody.data.scopePlan.some(
        (entry: { module: string }) => entry.module === "Work Schedule",
      ),
      true,
    );

    const legacyResponse = await fetch(
      `${baseUrl}/admin/role-templates/ADMIN_FULL/preview`,
      {
        method: "POST",
      },
    );
    assert.equal(legacyResponse.status, 400);

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
  const assignmentRepository = new InMemoryUserRoleAssignmentRepository();
  const assignmentRuleRepository = new InMemoryRoleAssignmentRuleRepository();
  const bridge = new InlineMutationBridge();

  const service = new RoleAdminService(
    roleRepository,
    assignmentRepository,
    assignmentRuleRepository,
    new InMemoryBusinessCodeSequenceRepository(),
    new AlwaysAssignableUserAccess(),
    new PermissiveAdminCapabilityRepository(),
    createAuditGuard(),
    bridge,
    createActorSnapshotCacheInvalidator(),
    noOpLogger,
  );

  const actor = createActor(ALL_PERMISSION_CODES);

  const result = await bindTraceId("trace-role-template-create", async () =>
    runWithDomainEventCollector(() =>
      service.createRoleFromTemplate(actor, {
        templateCode: "STAFF_CONSOLE_USER",
        code: "staff_console_user_custom",
        name: "Staff Console User Custom",
        description: "Staff console baseline",
      }),
    ),
  );

  const template = getRoleTemplate("STAFF_CONSOLE_USER");
  assert.notEqual(template, null);
  assert.equal(result.code, "STAFF_CONSOLE_USER_CUSTOM");
  assert.deepEqual(result.permissions, template?.permissions);
  assert.equal(result.templateCode, "STAFF_CONSOLE_USER");
  assert.equal(result.templateVersion, template?.version);
  assert.equal(typeof result.templateAppliedAt, "number");
  assert.equal(assignmentRepository.insertCount, 0);
  assert.equal("scopePlan" in roleRepository.inserted[0], false);
  assert.equal("scopeGrants" in roleRepository.inserted[0], false);
  assert.equal(bridge.mutationIdentities.includes("role.create"), true);
});

test("create role from template respects existing permission authoring constraints", async () => {
  const service = new RoleAdminService(
    new InMemoryRoleRepository(),
    new InMemoryUserRoleAssignmentRepository(),
    new InMemoryRoleAssignmentRuleRepository(),
    new InMemoryBusinessCodeSequenceRepository(),
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
      bindTraceId("trace-role-template-denied", async () =>
        runWithDomainEventCollector(() =>
          service.createRoleFromTemplate(actor, {
            templateCode: "OWNER_ADMIN",
            code: "owner_admin_copy",
            name: "Owner Admin Copy",
          }),
        ),
      ),
    /initialPermissions contains unauthorized permission code/,
  );
});

test("create role and create-from-template generate backend-owned role code when omitted", async () => {
  const roleRepository = new InMemoryRoleRepository();
  roleRepository.inserted.push({
    id: "role-existing-generated",
    code: "ROLE-000004",
    name: "Existing generated role",
    description: null,
    state: "DRAFT",
    permissions: [],
    delegationBand: "LIMITED",
    maxDelegatableBand: "NONE",
    createdAt: 1,
    updatedAt: 1,
    activatedAt: null,
    archivedAt: null,
  });

  const service = new RoleAdminService(
    roleRepository,
    new InMemoryUserRoleAssignmentRepository(),
    new InMemoryRoleAssignmentRuleRepository(),
    new InMemoryBusinessCodeSequenceRepository(),
    new AlwaysAssignableUserAccess(),
    new PermissiveAdminCapabilityRepository(),
    createAuditGuard(),
    new InlineMutationBridge(),
    createActorSnapshotCacheInvalidator(),
    noOpLogger,
  );

  const actor = createActor(ALL_PERMISSION_CODES);

  const custom = await bindTraceId(
    "trace-role-code-generate-custom",
    async () =>
      runWithDomainEventCollector(() =>
        service.createRole(actor, {
          name: "Generated custom role",
          initialPermissions: [Permission.ROLE_VIEW],
        }),
      ),
  );

  assert.equal(custom.code, "ROLE-000005");
  assert.deepEqual(custom.permissions, [Permission.ROLE_VIEW]);

  const templated = await bindTraceId(
    "trace-role-code-generate-template",
    async () =>
      runWithDomainEventCollector(() =>
        service.createRoleFromTemplate(actor, {
          templateCode: "VIEWER_AUDITOR",
          name: "Generated template role",
        }),
      ),
  );

  assert.equal(templated.code, "ROLE-000006");
  assert.equal(templated.templateCode, "VIEWER_AUDITOR");
  assert.equal(
    "scopeGrants" in
      roleRepository.inserted[roleRepository.inserted.length - 1],
    false,
  );
});

test("create role rejects duplicate manual code after normalization", async () => {
  const roleRepository = new InMemoryRoleRepository();
  const service = new RoleAdminService(
    roleRepository,
    new InMemoryUserRoleAssignmentRepository(),
    new InMemoryRoleAssignmentRuleRepository(),
    new InMemoryBusinessCodeSequenceRepository(),
    new AlwaysAssignableUserAccess(),
    new PermissiveAdminCapabilityRepository(),
    createAuditGuard(),
    new InlineMutationBridge(),
    createActorSnapshotCacheInvalidator(),
    noOpLogger,
  );
  const actor = createActor(ALL_PERMISSION_CODES);

  await bindTraceId("trace-role-manual-code-first", async () =>
    runWithDomainEventCollector(() =>
      service.createRole(actor, {
        code: " manual_role ",
        name: "Manual role",
      }),
    ),
  );

  assert.equal(roleRepository.inserted[0]?.code, "MANUAL_ROLE");

  await assert.rejects(
    () =>
      bindTraceId("trace-role-manual-code-duplicate", async () =>
        runWithDomainEventCollector(() =>
          service.createRole(actor, {
            code: "MANUAL_ROLE",
            name: "Duplicate manual role",
          }),
        ),
      ),
    RoleConflictError,
  );
});

test("create role retries generated duplicate-key collision and succeeds with later code", async () => {
  const roleRepository = new CollisionRoleRepository({
    duplicateGeneratedCodes: ["ROLE-000001"],
  });
  const sequenceRepository = new InMemoryBusinessCodeSequenceRepository();
  const service = new RoleAdminService(
    roleRepository,
    new InMemoryUserRoleAssignmentRepository(),
    new InMemoryRoleAssignmentRuleRepository(),
    sequenceRepository,
    new AlwaysAssignableUserAccess(),
    new PermissiveAdminCapabilityRepository(),
    createAuditGuard(),
    new InlineMutationBridge(),
    createActorSnapshotCacheInvalidator(),
    noOpLogger,
  );
  const actor = createActor(ALL_PERMISSION_CODES);

  const result = await bindTraceId(
    "trace-role-generated-code-collision-retry",
    async () =>
      runWithDomainEventCollector(() =>
        service.createRole(actor, {
          name: "Generated collision retry role",
        }),
      ),
  );

  assert.equal(result.code, "ROLE-000002");
  assert.equal(roleRepository.insertAttempts, 2);
  assert.equal(sequenceRepository.allocateCount, 2);
});

test("create role fails after bounded generated duplicate-key collisions are exhausted", async () => {
  const roleRepository = new CollisionRoleRepository({
    duplicateGeneratedCodes: [
      "ROLE-000001",
      "ROLE-000002",
      "ROLE-000003",
      "ROLE-000004",
      "ROLE-000005",
    ],
  });
  const sequenceRepository = new InMemoryBusinessCodeSequenceRepository();
  const service = new RoleAdminService(
    roleRepository,
    new InMemoryUserRoleAssignmentRepository(),
    new InMemoryRoleAssignmentRuleRepository(),
    sequenceRepository,
    new AlwaysAssignableUserAccess(),
    new PermissiveAdminCapabilityRepository(),
    createAuditGuard(),
    new InlineMutationBridge(),
    createActorSnapshotCacheInvalidator(),
    noOpLogger,
  );
  const actor = createActor(ALL_PERMISSION_CODES);

  await assert.rejects(
    () =>
      bindTraceId("trace-role-generated-code-collision-exhausted", async () =>
        runWithDomainEventCollector(() =>
          service.createRole(actor, {
            name: "Generated collision exhausted role",
          }),
        ),
      ),
    (error: unknown) =>
      error instanceof RoleConflictError &&
      error.message === "Generated role code conflict detected on create",
  );

  assert.equal(roleRepository.insertAttempts, 5);
  assert.equal(sequenceRepository.allocateCount, 5);
  assert.equal(roleRepository.inserted.length, 0);
});

function createActor(
  permissions: readonly string[],
  scopeGrants: ConstructorParameters<typeof Actor>[0]["scopeGrants"] = {},
): Actor {
  return new Actor({
    id: "admin-user-1",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions,
    scopeGrants,
    accountContexts: ["ADMIN_CONSOLE"],
    isActive: true,
  });
}

function listen(app: express.Express): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, "127.0.0.1", () => resolve(server));
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

  async insert(role: RoleRecord, _session: ClientSession): Promise<RoleRecord> {
    if (this.inserted.some((record) => record.code === role.code)) {
      throw duplicateKeyError();
    }

    this.inserted.push(role);
    return role;
  }

  async findById(roleId: string): Promise<RoleRecord | null> {
    return this.inserted.find((role) => role.id === roleId) ?? null;
  }

  async findByCode(code: string): Promise<RoleRecord | null> {
    return this.inserted.find((role) => role.code === code) ?? null;
  }

  async findMaxGeneratedCodeSequence(policy: {
    readonly prefix: string;
    readonly width: number;
  }): Promise<number> {
    const regex = new RegExp(`^${policy.prefix}-(\\d{${policy.width}})$`, "u");

    return this.inserted.reduce((max, role) => {
      const match = regex.exec(role.code);
      if (!match) {
        return max;
      }

      const sequence = Number(match[1]);
      return Number.isSafeInteger(sequence) && sequence > max ? sequence : max;
    }, 0);
  }

  async updateMetadata(
    input: UpdateRoleMetadataInput,
    _session: ClientSession,
  ): Promise<RoleRecord | null> {
    const index = this.inserted.findIndex((role) => role.id === input.roleId);
    if (index < 0) {
      return null;
    }

    const current = this.inserted[index];
    if (!current) {
      return null;
    }

    const updated: RoleRecord = {
      ...current,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.delegationBand !== undefined
        ? { delegationBand: input.delegationBand }
        : {}),
      ...(input.maxDelegatableBand !== undefined
        ? { maxDelegatableBand: input.maxDelegatableBand }
        : {}),
      updatedAt: input.updatedAt,
    };
    this.inserted[index] = updated;
    return updated;
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

class CollisionRoleRepository extends InMemoryRoleRepository {
  private readonly duplicateGeneratedCodes: Set<string>;
  insertAttempts = 0;

  constructor(params: { readonly duplicateGeneratedCodes: readonly string[] }) {
    super();
    this.duplicateGeneratedCodes = new Set(params.duplicateGeneratedCodes);
  }

  override async insert(
    role: RoleRecord,
    session: ClientSession,
  ): Promise<RoleRecord> {
    this.insertAttempts += 1;

    if (this.duplicateGeneratedCodes.has(role.code)) {
      this.duplicateGeneratedCodes.delete(role.code);
      throw duplicateKeyError();
    }

    return super.insert(role, session);
  }
}

class InMemoryBusinessCodeSequenceRepository implements BusinessCodeSequenceRepository {
  private values = new Map<string, number>();
  allocateCount = 0;

  async allocateNext(moduleKey: string, bucket: string): Promise<number> {
    this.allocateCount += 1;
    const key = `${moduleKey}:${bucket}`;
    const next = (this.values.get(key) ?? 0) + 1;
    this.values.set(key, next);
    return next;
  }

  async ensureAtLeast(
    moduleKey: string,
    bucket: string,
    minimumValue: number,
  ): Promise<void> {
    const key = `${moduleKey}:${bucket}`;
    const current = this.values.get(key) ?? 0;
    if (minimumValue > current) {
      this.values.set(key, minimumValue);
    }
  }
}

function duplicateKeyError(): MongoServerError {
  return new MongoServerError({
    message: "duplicate key",
    code: 11000,
  });
}

class InMemoryRoleAssignmentRuleRepository implements RoleAssignmentRuleRepository {
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

class InMemoryUserRoleAssignmentRepository implements UserRoleAssignmentRepository {
  insertCount = 0;
  readonly assignments: UserRoleAssignmentRecord[] = [];

  async insert(
    assignment: UserRoleAssignmentRecord,
    _session: ClientSession,
  ): Promise<UserRoleAssignmentRecord> {
    this.insertCount += 1;
    this.assignments.push(assignment);
    return assignment;
  }

  async findById(
    assignmentId: string,
  ): Promise<UserRoleAssignmentRecord | null> {
    return (
      this.assignments.find(
        (assignment) => assignment.assignmentId === assignmentId,
      ) ?? null
    );
  }

  async findActiveByRoleAndUser(
    roleId: string,
    userId: string,
  ): Promise<UserRoleAssignmentRecord | null> {
    return (
      this.assignments.find(
        (assignment) =>
          assignment.roleId === roleId &&
          assignment.userId === userId &&
          assignment.state === "ACTIVE",
      ) ?? null
    );
  }

  async findActiveByRoleUserAndScopeFingerprint(
    roleId: string,
    userId: string,
    scopeFingerprint: string,
  ): Promise<UserRoleAssignmentRecord | null> {
    return (
      this.assignments.find(
        (assignment) =>
          assignment.roleId === roleId &&
          assignment.userId === userId &&
          assignment.scopeFingerprint === scopeFingerprint &&
          assignment.state === "ACTIVE",
      ) ?? null
    );
  }

  async hasActiveAssignmentsForRole(): Promise<boolean> {
    return false;
  }

  async revokeById(
    assignmentId: string,
    reason: string | null,
    revokedAt: number,
    _session: ClientSession,
    revokedBy?: string,
  ): Promise<UserRoleAssignmentRecord | null> {
    const index = this.assignments.findIndex(
      (assignment) =>
        assignment.assignmentId === assignmentId &&
        assignment.state === "ACTIVE",
    );
    const current = this.assignments[index];
    if (index < 0 || !current) {
      return null;
    }
    const revoked: UserRoleAssignmentRecord = {
      ...current,
      state: "REVOKED",
      revokedAt,
      revokedBy: revokedBy ?? null,
      revokeReason: reason,
      updatedAt: revokedAt,
    };
    this.assignments[index] = revoked;
    return revoked;
  }
}

async function createAssignmentServiceHarness(): Promise<{
  readonly service: RoleAdminService;
  readonly assignmentRepository: InMemoryUserRoleAssignmentRepository;
}> {
  const roleRepository = new InMemoryRoleRepository();
  const assignmentRepository = new InMemoryUserRoleAssignmentRepository();
  const service = new RoleAdminService(
    roleRepository,
    assignmentRepository,
    new InMemoryRoleAssignmentRuleRepository(),
    new InMemoryBusinessCodeSequenceRepository(),
    new AlwaysAssignableUserAccess("ADMIN"),
    new PermissiveAdminCapabilityRepository(),
    createAuditGuard(),
    new InlineMutationBridge(),
    createActorSnapshotCacheInvalidator(),
    noOpLogger,
  );
  const now = Date.now();
  await roleRepository.insert(
    {
      id: "role-hr",
      code: "HR_OPERATIONS",
      name: "HR Operations",
      description: null,
      state: "ACTIVE",
      permissions: [Permission.USER_VIEW],
      delegationBand: "LIMITED",
      maxDelegatableBand: "NONE",
      createdAt: now,
      updatedAt: now,
      activatedAt: now,
      archivedAt: null,
    },
    {} as ClientSession,
  );
  return { service, assignmentRepository };
}

async function executeRoleMutation<T>(
  traceId: string,
  mutation: () => Promise<T>,
): Promise<T> {
  return await bindTraceId(
    traceId,
    async () =>
      await runWithDomainEventCollector(mutation),
  );
}

class AlwaysAssignableUserAccess implements RoleUserReadonlyAccess {
  constructor(
    private readonly actorKind: "ADMIN" | "STAFF" = "ADMIN",
    private readonly accountContexts: readonly (
      | "ADMIN_CONSOLE"
      | "MANAGER_CONSOLE"
      | "STAFF_CONSOLE"
    )[] = actorKind === "ADMIN" ? ["ADMIN_CONSOLE"] : ["STAFF_CONSOLE"],
  ) {}

  async isAssignableById(): Promise<boolean> {
    return true;
  }

  async getAssignableById(): Promise<{
    readonly id: string;
    readonly actorKind: "ADMIN" | "STAFF";
    readonly accountContexts: readonly (
      | "ADMIN_CONSOLE"
      | "MANAGER_CONSOLE"
      | "STAFF_CONSOLE"
    )[];
    readonly ref: {
      readonly id: string;
      readonly displayName: string;
    };
  } | null> {
    return {
      id: "target-user",
      actorKind: this.actorKind,
      accountContexts: this.accountContexts,
      ref: {
        id: "target-user",
        displayName: "Target User",
      },
    };
  }
}

class PermissiveAdminCapabilityRepository implements UserAdminCapabilityRepository {
  async listActiveUserIdsByPermission(
    permissionCodes: readonly string[],
    _session: ClientSession,
  ): Promise<Readonly<Record<string, readonly string[]>>> {
    return Object.fromEntries(
      permissionCodes.map((permission) => [permission, ["admin-user-1"]]),
    );
  }

  async hasActiveRoleAssignments(): Promise<boolean> {
    return true;
  }

  async listActiveAdminConsoleRoleCodesByUserId(): Promise<readonly string[]> {
    return ["OWNER_ADMIN"];
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

class InlineMutationBridge implements AuthoritativeAdminMutationBridge {
  readonly mutationIdentities: string[] = [];

  async execute<T>(
    params: Parameters<AuthoritativeAdminMutationBridge["execute"]>[0],
    mutate: Parameters<AuthoritativeAdminMutationBridge["execute"]>[1],
  ): Promise<T> {
    this.mutationIdentities.push(params.mutationIdentity);
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
