import crypto from "crypto";
import { Permission } from "@core/permission/permission.enum";
import type {
  RoleTemplateDefinition,
  RoleTemplateStatus,
} from "./role-template.catalog";

export const ROLE_TEMPLATE_CATALOG_PROVENANCE =
  "backend.role-template.catalog" as const;

export type RoleTemplateDriftClassification =
  | "MATCHED"
  | "STALE_MISSING_PERMISSIONS"
  | "STALE_EXTRA_PERMISSIONS"
  | "STALE_MIXED"
  | "LEGACY_COMPATIBILITY_ROLE"
  | "DEFERRED_NOT_ACTIVE"
  | "UNKNOWN_ORPHAN";

export interface PersistedRoleIntegrityInput {
  readonly code: string;
  readonly templateCode?: string;
  readonly templateVersion?: string;
  readonly permissions: readonly string[];
}

export interface RoleTemplateDriftResult {
  readonly classification: RoleTemplateDriftClassification;
  readonly sourceFingerprint: string | null;
  readonly persistedPermissionFingerprint: string;
  readonly versionMatched: boolean;
  readonly fingerprintMatched: boolean;
  readonly missingPermissions: readonly string[];
  readonly extraPermissions: readonly string[];
  readonly sourceProvenance: typeof ROLE_TEMPLATE_CATALOG_PROVENANCE;
}

export function buildPermissionFingerprint(
  permissions: readonly (Permission | string)[],
): string {
  const canonical = [...new Set(permissions.map((value) => value.trim()))]
    .filter(Boolean)
    .sort()
    .join("\n");
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function classifyRoleTemplateDrift(params: {
  readonly role: PersistedRoleIntegrityInput;
  readonly template: RoleTemplateDefinition | null;
  readonly legacyCodes: ReadonlySet<string>;
}): RoleTemplateDriftResult {
  const persistedPermissionFingerprint = buildPermissionFingerprint(
    params.role.permissions,
  );
  const governingCode = (params.role.templateCode ?? params.role.code).trim();
  const normalizedCodes = new Set([
    params.role.code.trim().toUpperCase(),
    governingCode.toUpperCase(),
  ]);

  if ([...normalizedCodes].some((code) => params.legacyCodes.has(code))) {
    return result("LEGACY_COMPATIBILITY_ROLE", null, false, [], []);
  }
  if (!params.template) {
    return result("UNKNOWN_ORPHAN", null, false, [], []);
  }
  if (isDeferred(params.template.status)) {
    return result(
      "DEFERRED_NOT_ACTIVE",
      params.template.permissionFingerprint,
      false,
      [],
      [],
    );
  }

  const expected = new Set<string>(params.template.permissions);
  const actual = new Set(params.role.permissions);
  const missingPermissions = [...expected].filter((item) => !actual.has(item)).sort();
  const extraPermissions = [...actual].filter((item) => !expected.has(item)).sort();
  const versionMatched = params.role.templateVersion === params.template.version;
  const fingerprintMatched =
    persistedPermissionFingerprint === params.template.permissionFingerprint;
  let classification: RoleTemplateDriftClassification = "MATCHED";
  if (missingPermissions.length > 0 && extraPermissions.length > 0) {
    classification = "STALE_MIXED";
  } else if (missingPermissions.length > 0) {
    classification = "STALE_MISSING_PERMISSIONS";
  } else if (extraPermissions.length > 0) {
    classification = "STALE_EXTRA_PERMISSIONS";
  } else if (!hasCanonicalProvenance(params.role, params.template)) {
    classification = "UNKNOWN_ORPHAN";
  } else if (!versionMatched || !fingerprintMatched) {
    classification = "STALE_MIXED";
  }

  return result(
    classification,
    params.template.permissionFingerprint,
    versionMatched,
    missingPermissions,
    extraPermissions,
    fingerprintMatched,
  );

  function result(
    classification: RoleTemplateDriftClassification,
    sourceFingerprint: string | null,
    versionMatched: boolean,
    missingPermissions: readonly string[],
    extraPermissions: readonly string[],
    fingerprintMatched = sourceFingerprint === persistedPermissionFingerprint,
  ): RoleTemplateDriftResult {
    return Object.freeze({
      classification,
      sourceFingerprint,
      persistedPermissionFingerprint,
      versionMatched,
      fingerprintMatched,
      missingPermissions: Object.freeze([...missingPermissions]),
      extraPermissions: Object.freeze([...extraPermissions]),
      sourceProvenance: ROLE_TEMPLATE_CATALOG_PROVENANCE,
    });
  }
}

function isDeferred(status: RoleTemplateStatus): boolean {
  return status !== "READY";
}

function hasCanonicalProvenance(
  role: PersistedRoleIntegrityInput,
  template: RoleTemplateDefinition,
): boolean {
  return (
    role.templateCode?.trim().toUpperCase() === template.code &&
    typeof role.templateVersion === "string" &&
    role.templateVersion.trim().length > 0
  );
}
