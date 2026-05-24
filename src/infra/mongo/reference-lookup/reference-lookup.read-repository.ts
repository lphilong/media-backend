import { Collection, Db } from "mongodb";
import {
  ListReferenceLookupInput,
  ReferenceLookupReadRepository,
} from "@modules/reference-lookup/read/reference-lookup.read-repository";
import {
  ReferenceLookupDomain,
  ReferenceLookupItem,
} from "@modules/reference-lookup/shared/reference-lookup.contracts";

type LookupDocument = Record<string, unknown>;

interface LookupConfig {
  readonly collection: string;
  readonly projection: Readonly<Record<string, 1>>;
  readonly searchFields: readonly string[];
  readonly sort: Readonly<Record<string, 1>>;
  readonly archivedField: string;
  readonly map: (document: LookupDocument) => ReferenceLookupItem;
}

const LOOKUP_CONFIG_BY_DOMAIN: Readonly<
  Record<ReferenceLookupDomain, LookupConfig>
> = Object.freeze({
  orgUnits: {
    collection: "org_units",
    projection: {
      _id: 1,
      code: 1,
      name: 1,
      status: 1,
      type: 1,
    },
    searchFields: ["code", "name"],
    sort: { code: 1, _id: 1 },
    archivedField: "status",
    map: (document) =>
      item(document, {
        label: readString(document, "name") ?? "",
        secondaryLabel: undefined,
        code: readString(document, "code"),
        status: readString(document, "status"),
        type: readString(document, "type"),
      }),
  },
  employmentProfiles: {
    collection: "employment_profiles",
    projection: {
      _id: 1,
      employeeCode: 1,
      legalName: 1,
      displayName: 1,
      jobTitle: 1,
      employmentStatus: 1,
      contractStatus: 1,
    },
    searchFields: ["employeeCode", "legalName", "displayName"],
    sort: { employeeCode: 1, _id: 1 },
    archivedField: "employmentStatus",
    map: (document) =>
      item(document, {
        label:
          readString(document, "displayName") ??
          readString(document, "legalName") ??
          "",
        secondaryLabel: readString(document, "jobTitle"),
        code: readString(document, "employeeCode"),
        status: readString(document, "employmentStatus"),
        state: readString(document, "contractStatus"),
      }),
  },
  talents: {
    collection: "talents",
    projection: {
      _id: 1,
      talentCode: 1,
      stageName: 1,
      legalName: 1,
      displayShortName: 1,
      operationalStatus: 1,
    },
    searchFields: ["talentCode", "stageName", "legalName", "displayShortName"],
    sort: { talentCode: 1, _id: 1 },
    archivedField: "operationalStatus",
    map: (document) =>
      item(document, {
        label: readString(document, "stageName") ?? "",
        secondaryLabel:
          readString(document, "displayShortName") ??
          readString(document, "legalName"),
        code: readString(document, "talentCode"),
        status: readString(document, "operationalStatus"),
      }),
  },
  talentGroups: {
    collection: "talent_groups",
    projection: {
      _id: 1,
      groupCode: 1,
      name: 1,
      shortName: 1,
      status: 1,
    },
    searchFields: ["groupCode", "name", "shortName"],
    sort: { groupCode: 1, _id: 1 },
    archivedField: "status",
    map: (document) =>
      item(document, {
        label: readString(document, "name") ?? "",
        secondaryLabel: readString(document, "shortName"),
        code: readString(document, "groupCode"),
        status: readString(document, "status"),
      }),
  },
  platformAccounts: {
    collection: "platform_accounts",
    projection: {
      _id: 1,
      accountCode: 1,
      displayName: 1,
      platform: 1,
      platformSurfaceType: 1,
      operationalStatus: 1,
    },
    searchFields: ["accountCode", "displayName"],
    sort: { accountCode: 1, _id: 1 },
    archivedField: "operationalStatus",
    map: (document) =>
      item(document, {
        label: readString(document, "displayName") ?? "",
        secondaryLabel: readString(document, "platform"),
        code: readString(document, "accountCode"),
        status: readString(document, "operationalStatus"),
        type: readString(document, "platformSurfaceType"),
      }),
  },
  studioResources: {
    collection: "studio_resources",
    projection: {
      _id: 1,
      resourceCode: 1,
      name: 1,
      shortName: 1,
      resourceClass: 1,
      operationalStatus: 1,
      locationLabel: 1,
    },
    searchFields: ["resourceCode", "name", "shortName"],
    sort: { resourceCode: 1, _id: 1 },
    archivedField: "operationalStatus",
    map: (document) =>
      item(document, {
        label:
          readString(document, "shortName") ??
          readString(document, "name") ??
          "",
        secondaryLabel: readString(document, "locationLabel"),
        code: readString(document, "resourceCode"),
        status: readString(document, "operationalStatus"),
        type: readString(document, "resourceClass"),
      }),
  },
  events: {
    collection: "events",
    projection: {
      _id: 1,
      eventCode: 1,
      title: 1,
      status: 1,
    },
    searchFields: ["eventCode", "title"],
    sort: { eventCode: 1, _id: 1 },
    archivedField: "status",
    map: (document) =>
      item(document, {
        label: readString(document, "title") ?? "",
        code: readString(document, "eventCode"),
        status: readString(document, "status"),
      }),
  },
  contractRecords: {
    collection: "contract_records",
    projection: {
      _id: 1,
      contractCode: 1,
      title: 1,
      contractKind: 1,
      linkedEntityKind: 1,
      status: 1,
    },
    searchFields: ["contractCode", "title"],
    sort: { contractCode: 1, _id: 1 },
    archivedField: "status",
    map: (document) =>
      item(document, {
        label: readString(document, "title") ?? "",
        secondaryLabel: readString(document, "linkedEntityKind"),
        code: readString(document, "contractCode"),
        status: readString(document, "status"),
        type: readString(document, "contractKind"),
      }),
  },
  revenueEntries: {
    collection: "revenue_entries",
    projection: {
      _id: 1,
      revenueEntryCode: 1,
      title: 1,
      revenueKind: 1,
      status: 1,
      currencyCode: 1,
    },
    searchFields: ["revenueEntryCode", "title"],
    sort: { revenueEntryCode: 1, _id: 1 },
    archivedField: "status",
    map: (document) =>
      item(document, {
        label: readString(document, "title") ?? "",
        secondaryLabel: readString(document, "currencyCode"),
        code: readString(document, "revenueEntryCode"),
        status: readString(document, "status"),
        type: readString(document, "revenueKind"),
      }),
  },
  commissionRules: {
    collection: "commission_rules",
    projection: {
      _id: 1,
      ruleCode: 1,
      title: 1,
      settlementKind: 1,
      beneficiaryKind: 1,
      status: 1,
    },
    searchFields: ["ruleCode", "title"],
    sort: { ruleCode: 1, _id: 1 },
    archivedField: "status",
    map: (document) =>
      item(document, {
        label: readString(document, "title") ?? "",
        secondaryLabel: readString(document, "beneficiaryKind"),
        code: readString(document, "ruleCode"),
        status: readString(document, "status"),
        type: readString(document, "settlementKind"),
      }),
  },
});

export class NativeMongoReferenceLookupReadRepository implements ReferenceLookupReadRepository {
  constructor(private readonly db: Db) {}

  async listReferenceOptions(
    input: ListReferenceLookupInput,
  ): Promise<readonly ReferenceLookupItem[]> {
    const config = LOOKUP_CONFIG_BY_DOMAIN[input.domain];
    const collection: Collection<LookupDocument> =
      this.db.collection<LookupDocument>(config.collection);

    const documents = await collection
      .find(buildQuery(config, input.search, input.ids), {
        projection: config.projection,
      })
      .sort(config.sort)
      .limit(input.limit)
      .toArray();

    return documents.map(config.map);
  }
}

export function escapeReferenceLookupRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function buildQuery(
  config: LookupConfig,
  search: string | undefined,
  ids: readonly string[] | undefined,
): Record<string, unknown> {
  const filters: Array<Record<string, unknown>> = [
    {
      [config.archivedField]: {
        $ne: "ARCHIVED",
      },
    },
  ];

  if (ids && ids.length > 0) {
    filters.push({
      _id: {
        $in: [...ids],
      },
    });
  }

  if (search) {
    const escaped = escapeReferenceLookupRegex(search);
    const expression = new RegExp(escaped, "iu");
    filters.push({
      $or: config.searchFields.map((field) => ({
        [field]: {
          $regex: expression,
        },
      })),
    });
  }

  return filters.length === 1 ? (filters[0] ?? {}) : { $and: filters };
}

function item(
  document: LookupDocument,
  input: Omit<ReferenceLookupItem, "id">,
): ReferenceLookupItem {
  return omitUndefined({
    id: readRequiredString(document, "_id"),
    ...input,
  });
}

function readRequiredString(document: LookupDocument, field: string): string {
  return readString(document, field) ?? "";
}

function readString(
  document: LookupDocument,
  field: string,
): string | undefined {
  const value = document[field];
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function omitUndefined(item: ReferenceLookupItem): ReferenceLookupItem {
  return Object.fromEntries(
    Object.entries(item).filter(([, value]) => value !== undefined),
  ) as ReferenceLookupItem;
}
