import assert from "node:assert/strict";
import { test } from "node:test";
import { Permission } from "@core/permission/permission.enum";
import {
  classifySensitiveAccess,
  validateSensitiveAccessLifecycle,
} from "@modules/role/domain/sensitive-access-policy";

const EFFECTIVE_AT = Date.UTC(2026, 0, 1);

test("sensitive access taxonomy classifies role, permission, bundle, and scope risk", () => {
  const owner = classifySensitiveAccess([
    {
      roleCode: "OWNER_ADMIN",
      permissions: [Permission.ROLE_ASSIGN_TO_USER],
      structuredScopeGrants: [{ scopeType: "global" }],
      bundleCode: "OWNER_ADMIN_BUNDLE",
    },
  ]);
  assert.equal(owner.isSensitive, true);
  assert.equal(owner.isGlobalLike, true);
  assert.equal(owner.isHighRisk, true);
  assert.equal(owner.requiresReview, true);
  assert.equal(owner.requiresExpiry, true);
  assert.equal(owner.isBreakGlassLike, true);
  assert.equal(owner.maxReviewWindowDays, 14);
  assert.equal(owner.maxExpiryWindowDays, 14);
  assert.deepEqual(owner.sensitiveRoleCodes, ["OWNER_ADMIN"]);
  assert.equal(owner.sensitivePermissions.includes(Permission.ROLE_ASSIGN_TO_USER), true);

  const hret = classifySensitiveAccess([
    {
      roleCode: "HR_TERMS_APPROVER",
      permissions: [
        Permission.EMPLOYMENT_TERMS_READ,
        Permission.EMPLOYMENT_TERMS_READ_SENSITIVE,
      ],
      structuredScopeGrants: [{ scopeType: "managedOrgUnit", targetId: "org-1" }],
    },
  ]);
  assert.equal(hret.isSensitive, true);
  assert.equal(hret.isGlobalLike, false);
  assert.equal(hret.requiresReview, true);
  assert.equal(
    hret.sensitivePermissions.includes(Permission.EMPLOYMENT_TERMS_READ_SENSITIVE),
    true,
  );

  const financeGlobal = classifySensitiveAccess([
    {
      roleCode: "REVENUE_FINANCE_OPS",
      permissions: [Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT],
      structuredScopeGrants: [{ scopeType: "financeGlobal" }],
      bundleCode: "FINANCE_STAFF_BUNDLE",
    },
  ]);
  assert.equal(financeGlobal.isSensitive, true);
  assert.equal(financeGlobal.isGlobalLike, true);
  assert.equal(financeGlobal.requiresReview, true);
  assert.equal(financeGlobal.maxReviewWindowDays, 90);

  const scopedAuditor = classifySensitiveAccess([
    {
      roleCode: "VIEWER_AUDITOR",
      permissions: [Permission.KPI_READ],
      structuredScopeGrants: [{ scopeType: "managedOrgUnit", targetId: "org-1" }],
      bundleCode: "AUDITOR_BUNDLE",
    },
  ]);
  assert.equal(scopedAuditor.isSensitive, false);
  assert.equal(scopedAuditor.requiresReview, false);
});

test("sensitive access lifecycle validation enforces review and break-glass expiry windows", () => {
  const globalAudit = classifySensitiveAccess([
    {
      roleCode: "VIEWER_AUDITOR",
      permissions: [Permission.KPI_READ],
      structuredScopeGrants: [{ scopeType: "global" }],
    },
  ]);
  assert.deepEqual(
    validateSensitiveAccessLifecycle(globalAudit, {
      effectiveAt: EFFECTIVE_AT,
      reviewAt: null,
      expiresAt: null,
    }).blockers.map((item) => item.code),
    ["REVIEW_AT_REQUIRED"],
  );
  assert.deepEqual(
    validateSensitiveAccessLifecycle(globalAudit, {
      effectiveAt: EFFECTIVE_AT,
      reviewAt: Date.UTC(2026, 3, 30),
      expiresAt: null,
    }).blockers.map((item) => item.code),
    ["REVIEW_AT_EXCEEDS_MAX_WINDOW"],
  );

  const owner = classifySensitiveAccess([
    {
      roleCode: "OWNER_ADMIN",
      permissions: [Permission.ROLE_ASSIGN_TO_USER],
      structuredScopeGrants: [{ scopeType: "global" }],
    },
  ]);
  assert.deepEqual(
    validateSensitiveAccessLifecycle(owner, {
      effectiveAt: EFFECTIVE_AT,
      reviewAt: Date.UTC(2026, 0, 8),
      expiresAt: null,
    }).blockers.map((item) => item.code),
    ["EXPIRES_AT_REQUIRED"],
  );
});
