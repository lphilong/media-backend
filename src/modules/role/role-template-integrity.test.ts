import assert from "node:assert/strict";
import test from "node:test";
import { Permission } from "@core/permission/permission.enum";
import {
  LEGACY_ROLE_TEMPLATE_CODES,
  getRoleTemplate,
} from "./domain/role-template.catalog";
import {
  buildPermissionFingerprint,
  classifyRoleTemplateDrift,
} from "./domain/role-template-integrity";

const legacyCodes = new Set<string>(LEGACY_ROLE_TEMPLATE_CODES);

test("permission fingerprint is deterministic and detects missing, extra, and mixed drift", () => {
  assert.equal(
    buildPermissionFingerprint([Permission.KPI_READ, Permission.KPI_ENTER_ACTUAL]),
    buildPermissionFingerprint([Permission.KPI_ENTER_ACTUAL, Permission.KPI_READ]),
  );
  const template = getRoleTemplate("TALENT_GROUP_MANAGER");
  assert.ok(template);
  const base = {
    code: template.code,
    templateCode: template.code,
    templateVersion: template.version,
  };
  assert.equal(classifyRoleTemplateDrift({ role: { ...base, permissions: template.permissions }, template, legacyCodes }).classification, "MATCHED");
  assert.equal(classifyRoleTemplateDrift({ role: { ...base, permissions: template.permissions.slice(1) }, template, legacyCodes }).classification, "STALE_MISSING_PERMISSIONS");
  assert.equal(classifyRoleTemplateDrift({ role: { ...base, permissions: [...template.permissions, "legacy.extra"] }, template, legacyCodes }).classification, "STALE_EXTRA_PERMISSIONS");
  assert.equal(classifyRoleTemplateDrift({ role: { ...base, permissions: [...template.permissions.slice(1), "legacy.extra"] }, template, legacyCodes }).classification, "STALE_MIXED");
});

test("matching version cannot hide permission drift and legacy/orphans remain explicit", () => {
  const template = getRoleTemplate("OWNER_ADMIN");
  assert.ok(template);
  const drift = classifyRoleTemplateDrift({
    role: {
      code: template.code,
      templateCode: template.code,
      templateVersion: template.version,
      permissions: template.permissions.slice(1),
    },
    template,
    legacyCodes,
  });
  assert.equal(drift.versionMatched, true);
  assert.equal(drift.classification, "STALE_MISSING_PERMISSIONS");
  assert.equal(classifyRoleTemplateDrift({ role: { code: "ADMIN_FULL", permissions: [] }, template: null, legacyCodes }).classification, "LEGACY_COMPATIBILITY_ROLE");
  assert.equal(classifyRoleTemplateDrift({ role: { code: "ORPHAN", permissions: [] }, template: null, legacyCodes }).classification, "UNKNOWN_ORPHAN");
});

test("metadata-less canonical Roles are compared exactly but cannot claim synchronized provenance", () => {
  const template = getRoleTemplate("TALENT_GROUP_MANAGER");
  assert.ok(template);
  const classify = (permissions: readonly string[]) =>
    classifyRoleTemplateDrift({
      role: { code: template.code, permissions },
      template,
      legacyCodes,
    });

  const missing = classify(template.permissions.slice(1));
  assert.equal(missing.classification, "STALE_MISSING_PERMISSIONS");
  assert.deepEqual(missing.missingPermissions, [template.permissions[0]]);

  const extra = classify([...template.permissions, "legacy.extra"]);
  assert.equal(extra.classification, "STALE_EXTRA_PERMISSIONS");
  assert.deepEqual(extra.extraPermissions, ["legacy.extra"]);

  const mixed = classify([...template.permissions.slice(1), "legacy.extra"]);
  assert.equal(mixed.classification, "STALE_MIXED");
  assert.equal(mixed.missingPermissions.length, 1);
  assert.deepEqual(mixed.extraPermissions, ["legacy.extra"]);

  const exact = classify(template.permissions);
  assert.equal(exact.classification, "UNKNOWN_ORPHAN");
  assert.equal(exact.fingerprintMatched, true);
  assert.equal(exact.versionMatched, false);
});

test("canonical Team Manager and Owner templates enforce current policy", () => {
  const manager = getRoleTemplate("TALENT_GROUP_MANAGER");
  const owner = getRoleTemplate("OWNER_ADMIN");
  assert.ok(manager && owner);
  for (const permission of [
    Permission.MANAGER_GROUP_READ,
    Permission.MANAGER_MEMBER_READ,
    Permission.KPI_READ,
    Permission.KPI_READ_PROGRESS,
    Permission.KPI_MANAGE_ALLOCATION,
    Permission.KPI_ENTER_ACTUAL,
    Permission.KPI_CORRECT_ACTUAL,
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_READ,
  ]) assert.equal(manager.permissions.includes(permission), true, permission);
  for (const permission of [
    Permission.KPI_CREATE_PLAN,
    Permission.KPI_APPROVE_ALLOCATION,
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
    Permission.REVENUE_LEDGER_CREATE,
    Permission.EVENT_UPDATE,
  ]) assert.equal(manager.permissions.includes(permission), false, permission);
  assert.equal(owner.permissions.includes(Permission.MANAGER_GROUP_READ), true);
  assert.equal(owner.permissions.includes(Permission.MANAGER_MEMBER_READ), true);
  assert.equal(owner.permissions.includes(Permission.TALENT_KPI_READ), false);
});
