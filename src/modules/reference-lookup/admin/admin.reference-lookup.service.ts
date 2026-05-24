import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { ReferenceLookupValidationError } from "@modules/reference-lookup/domain/reference-lookup.errors";
import { ReferenceLookupReadRepository } from "@modules/reference-lookup/read/reference-lookup.read-repository";
import {
  ReferenceLookupDomain,
  ReferenceLookupQuery,
  ReferenceLookupResult,
} from "@modules/reference-lookup/shared/reference-lookup.contracts";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const PERMISSION_BY_DOMAIN: Readonly<
  Record<
    ReferenceLookupDomain,
    {
      readonly lookup: Permission;
      readonly read: Permission;
    }
  >
> = Object.freeze({
  orgUnits: {
    lookup: Permission.ORG_UNIT_LOOKUP,
    read: Permission.ORG_UNIT_READ,
  },
  employmentProfiles: {
    lookup: Permission.EMPLOYMENT_PROFILE_LOOKUP,
    read: Permission.EMPLOYMENT_PROFILE_READ,
  },
  talents: {
    lookup: Permission.TALENT_LOOKUP,
    read: Permission.TALENT_READ,
  },
  talentGroups: {
    lookup: Permission.TALENT_GROUP_LOOKUP,
    read: Permission.TALENT_GROUP_READ,
  },
  platformAccounts: {
    lookup: Permission.PLATFORM_ACCOUNT_LOOKUP,
    read: Permission.PLATFORM_ACCOUNT_READ,
  },
  studioResources: {
    lookup: Permission.STUDIO_RESOURCE_LOOKUP,
    read: Permission.STUDIO_RESOURCE_READ,
  },
  events: {
    lookup: Permission.EVENT_LOOKUP,
    read: Permission.EVENT_READ,
  },
  contractRecords: {
    lookup: Permission.CONTRACT_REGISTRY_LOOKUP,
    read: Permission.CONTRACT_REGISTRY_READ,
  },
  revenueEntries: {
    lookup: Permission.REVENUE_LEDGER_LOOKUP,
    read: Permission.REVENUE_LEDGER_READ,
  },
  commissionRules: {
    lookup: Permission.COMMISSION_RULE_LOOKUP,
    read: Permission.COMMISSION_RULE_READ,
  },
});

export class ReferenceLookupAdminService {
  constructor(
    private readonly readRepository: ReferenceLookupReadRepository,
  ) {}

  async listReferenceOptions(
    actor: Actor,
    query: ReferenceLookupQuery,
  ): Promise<ReferenceLookupResult> {
    PermissionGuard.assertAdminActor(actor);
    assertLookupOrReadPermission(actor, query.domain);

    const items =
      await this.readRepository.listReferenceOptions({
        domain: query.domain,
        search: parseOptionalSearch(query.search),
        limit: parseLimit(query.limit),
      });

    return { items };
  }
}

function assertLookupOrReadPermission(
  actor: Actor,
  domain: ReferenceLookupDomain,
): void {
  const permission = PERMISSION_BY_DOMAIN[domain];
  const hasLookup = actor.permissions.includes(
    permission.lookup,
  );
  const hasRead = actor.permissions.includes(permission.read);

  if (hasLookup || hasRead) {
    return;
  }

  PermissionGuard.assert(
    actor,
    PermissionResolver.resolve(permission.lookup),
  );
}

function parseLimit(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_LIMIT;
  }

  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new ReferenceLookupValidationError(
      "limit must be a positive integer",
    );
  }

  return Math.min(numeric, MAX_LIMIT);
}

function parseOptionalSearch(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ReferenceLookupValidationError(
      "search must be a string",
    );
  }

  const normalized = value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");

  return normalized.length > 0 ? normalized : undefined;
}
