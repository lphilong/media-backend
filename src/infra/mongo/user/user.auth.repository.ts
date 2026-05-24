import { ClientSession, Collection, Db, Document } from "mongodb";
import { AuthSecurityVersionReader } from "@core/auth/auth-security-version.repository";
import {
  ActorScopeGrants,
  CommissionActorScopeGrant,
  ContractRegistryActorScopeGrant,
  DashboardLiteActorScopeGrant,
  EventAssignmentActorScopeGrant,
  KpiActorScopeGrant,
  RevenueLedgerActorScopeGrant,
  TalentKpiActorScopeGrant,
  WorkScheduleActorScopeGrant,
} from "@core/actor/actor";
import { InfrastructureError } from "@infra/errors/infrastructure.error";
import {
  RoleMaxDelegatableBandForCapability,
  UserAdminCapabilityRepository,
} from "@modules/user/domain/user.admin-capability.repository";
import {
  UserAuthResolutionCandidate,
  UserAuthResolutionRepository,
} from "@modules/user/shared/user.actor-resolution.facade";
import { UserMapper } from "./user.mapper";
import { UserPersistence } from "./user.persistence";

const BASELINE_AUTH_SECURITY_VERSION = "bootstrap";
const AUTH_SECURITY_VERSION_DOCUMENT_ID = "admin.auth-security-version";
const WORK_SCHEDULE_SCOPE_GRANTS_ORDER: readonly WorkScheduleActorScopeGrant[] =
  Object.freeze(["self", "team", "department", "global"]);
const EVENT_ASSIGNMENT_SCOPE_GRANTS_ORDER: readonly EventAssignmentActorScopeGrant[] =
  Object.freeze(["global", "managedGroup"]);
const CONTRACT_REGISTRY_SCOPE_GRANTS_ORDER: readonly ContractRegistryActorScopeGrant[] =
  Object.freeze(["global"]);
const TALENT_KPI_SCOPE_GRANTS_ORDER: readonly TalentKpiActorScopeGrant[] =
  Object.freeze(["global"]);
const KPI_SCOPE_GRANTS_ORDER: readonly KpiActorScopeGrant[] = Object.freeze([
  "global",
  "managedGroup",
  "self",
]);
const REVENUE_LEDGER_SCOPE_GRANTS_ORDER: readonly RevenueLedgerActorScopeGrant[] =
  Object.freeze(["global"]);
const COMMISSION_SCOPE_GRANTS_ORDER: readonly CommissionActorScopeGrant[] =
  Object.freeze(["global"]);
const DASHBOARD_LITE_SCOPE_GRANTS_ORDER: readonly DashboardLiteActorScopeGrant[] =
  Object.freeze(["global"]);
const ADMIN_CONSOLE_ROLE_CODES: readonly string[] = Object.freeze([
  "ADMIN_FULL",
  "HR_OPERATIONS",
  "TEAM_MANAGER",
  "PRODUCTION_OPS",
  "COMMERCIAL_FINANCE",
  "VIEWER_AUDITOR",
]);

interface UserAuthResolutionAggregateDocument {
  readonly _id: string;
  readonly actorKind: UserPersistence["actorKind"];
  readonly accountStatus: UserPersistence["accountStatus"];
  readonly assignmentRoleIds?: readonly unknown[];
  readonly resolvedRoleIds?: readonly unknown[];
  readonly rolePermissions?: readonly unknown[];
  readonly roleMaxDelegatableBands?: readonly unknown[];
  readonly scopeGrants?: unknown;
  readonly assignmentScopeGrants?: readonly unknown[];
}

interface ActiveRoleAssignmentProbeDocument {
  readonly hasActiveRoleAssignments?: unknown;
}

interface ActiveAdminConsoleRoleDocument {
  readonly activeAdminConsoleRoleCodes?: readonly unknown[];
}

interface AuthSecurityVersionDocument {
  readonly _id: string;
  readonly version: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export class MongoUserAuthRepository
  implements
    UserAuthResolutionRepository,
    UserAdminCapabilityRepository,
    AuthSecurityVersionReader
{
  private readonly collection: Collection<UserPersistence>;
  private readonly authSecurityVersionCollection: Collection<AuthSecurityVersionDocument>;

  constructor(db: Db) {
    this.collection = db.collection<UserPersistence>("users");
    this.authSecurityVersionCollection =
      db.collection<AuthSecurityVersionDocument>("auth_security_versions");
  }

  async findByAuthSubject(
    authSubject: string,
  ): Promise<readonly UserAuthResolutionCandidate[]> {
    const docs = await this.collection
      .aggregate<UserAuthResolutionAggregateDocument>(
        buildAuthResolutionPipeline(authSubject),
      )
      .toArray();

    return docs.map((doc) => {
      const assignmentRoleIds = toSortedUniqueStrings(
        doc.assignmentRoleIds,
        "USER_AUTH_ASSIGNMENT_INVALID_ROLE_ID",
        `Invalid active role assignment roleId for user ${doc._id}`,
      );
      const resolvedRoleIds = toSortedUniqueStrings(
        doc.resolvedRoleIds,
        "USER_AUTH_ROLE_INVALID_ID",
        `Invalid active role id for user ${doc._id}`,
      );

      assertNoUnresolvedRoleAssignments(
        doc._id,
        assignmentRoleIds,
        resolvedRoleIds,
      );

      return UserMapper.toAuthResolutionCandidate({
        _id: doc._id,
        actorKind: doc.actorKind,
        accountStatus: doc.accountStatus,
        permissions: toRuntimePermissionSet(doc.rolePermissions, doc._id),
        scopeGrants: toRuntimeActorScopeGrants(
          doc.scopeGrants,
          doc._id,
          doc.assignmentScopeGrants,
        ),
      });
    });
  }

  async listActiveUserIdsByPermission(
    permissionCodes: readonly string[],
    session: ClientSession,
  ): Promise<Readonly<Record<string, readonly string[]>>> {
    const normalizedCodes = normalizePermissionCodes(permissionCodes);

    if (normalizedCodes.length === 0) {
      return {};
    }

    const docs = await this.collection
      .aggregate<UserAuthResolutionAggregateDocument>(
        buildActivePermissionProjectionPipeline(),
        { session },
      )
      .toArray();

    const result = initializePermissionUserMap(normalizedCodes);

    for (const doc of docs) {
      const assignmentRoleIds = toSortedUniqueStrings(
        doc.assignmentRoleIds,
        "USER_AUTH_ASSIGNMENT_INVALID_ROLE_ID",
        `Invalid active role assignment roleId for user ${doc._id}`,
      );
      const resolvedRoleIds = toSortedUniqueStrings(
        doc.resolvedRoleIds,
        "USER_AUTH_ROLE_INVALID_ID",
        `Invalid active role id for user ${doc._id}`,
      );

      assertNoUnresolvedRoleAssignments(
        doc._id,
        assignmentRoleIds,
        resolvedRoleIds,
      );

      const resolvedPermissions = new Set(
        toRuntimePermissionSet(doc.rolePermissions, doc._id),
      );

      for (const permissionCode of normalizedCodes) {
        if (!resolvedPermissions.has(permissionCode)) {
          continue;
        }

        result[permissionCode]?.push(doc._id);
      }
    }

    return finalizePermissionUserMap(result);
  }

  async hasActiveRoleAssignments(
    userId: string,
    session: ClientSession,
  ): Promise<boolean> {
    const docs = await this.collection
      .aggregate<ActiveRoleAssignmentProbeDocument>(
        buildActiveRoleAssignmentProbePipeline(userId),
        { session },
      )
      .toArray();

    if (docs.length === 0) {
      return false;
    }

    return coerceHasActiveRoleAssignmentFlag(
      docs[0]?.hasActiveRoleAssignments,
      userId,
    );
  }

  async listActiveAdminConsoleRoleCodesByUserId(
    userId: string,
    session: ClientSession,
  ): Promise<readonly string[]> {
    const docs = await this.collection
      .aggregate<ActiveAdminConsoleRoleDocument>(
        buildActiveAdminConsoleRoleCodePipeline(userId),
        { session },
      )
      .toArray();

    if (docs.length === 0) {
      return [];
    }

    return toSortedUniqueStrings(
      docs[0]?.activeAdminConsoleRoleCodes,
      "USER_AUTH_ADMIN_ROLE_CODE_INVALID",
      `Invalid active admin-console role code for user ${userId}`,
    ).filter((code) => ADMIN_CONSOLE_ROLE_CODES.includes(code));
  }

  async listActiveDelegationCeilingsByUserId(
    userId: string,
    session: ClientSession,
  ): Promise<readonly RoleMaxDelegatableBandForCapability[]> {
    const docs = await this.collection
      .aggregate<UserAuthResolutionAggregateDocument>(
        buildActiveDelegationCeilingPipeline(userId),
        { session },
      )
      .toArray();

    if (docs.length === 0) {
      return [];
    }

    const doc = docs[0];

    if (!doc) {
      return [];
    }

    const assignmentRoleIds = toSortedUniqueStrings(
      doc.assignmentRoleIds,
      "USER_AUTH_ASSIGNMENT_INVALID_ROLE_ID",
      `Invalid active role assignment roleId for user ${doc._id}`,
    );
    const resolvedRoleIds = toSortedUniqueStrings(
      doc.resolvedRoleIds,
      "USER_AUTH_ROLE_INVALID_ID",
      `Invalid active role id for user ${doc._id}`,
    );

    assertNoUnresolvedRoleAssignments(
      doc._id,
      assignmentRoleIds,
      resolvedRoleIds,
    );

    return toRuntimeDelegationCeilingSet(doc.roleMaxDelegatableBands, doc._id);
  }

  async listActiveUserIdsWithGovernanceRecoverySurface(
    permissionCodes: readonly string[],
    minimumDelegatableBand: RoleMaxDelegatableBandForCapability,
    session: ClientSession,
  ): Promise<readonly string[]> {
    const normalizedCodes = normalizePermissionCodes(permissionCodes);

    if (normalizedCodes.length === 0) {
      return [];
    }

    assertDelegatableBand(minimumDelegatableBand);

    const docs = await this.collection
      .aggregate<UserAuthResolutionAggregateDocument>(
        buildActivePermissionProjectionPipeline(),
        { session },
      )
      .toArray();

    const userIds: string[] = [];

    for (const doc of docs) {
      const assignmentRoleIds = toSortedUniqueStrings(
        doc.assignmentRoleIds,
        "USER_AUTH_ASSIGNMENT_INVALID_ROLE_ID",
        `Invalid active role assignment roleId for user ${doc._id}`,
      );
      const resolvedRoleIds = toSortedUniqueStrings(
        doc.resolvedRoleIds,
        "USER_AUTH_ROLE_INVALID_ID",
        `Invalid active role id for user ${doc._id}`,
      );

      assertNoUnresolvedRoleAssignments(
        doc._id,
        assignmentRoleIds,
        resolvedRoleIds,
      );

      const resolvedPermissions = new Set(
        toRuntimePermissionSet(doc.rolePermissions, doc._id),
      );

      if (
        !normalizedCodes.every((permissionCode) =>
          resolvedPermissions.has(permissionCode),
        )
      ) {
        continue;
      }

      const delegationCeilings = toRuntimeDelegationCeilingSet(
        doc.roleMaxDelegatableBands,
        doc._id,
      );

      if (
        !delegationCeilings.some((ceiling) =>
          isDelegatableBandAtLeast(ceiling, minimumDelegatableBand),
        )
      ) {
        continue;
      }

      userIds.push(doc._id);
    }

    return [...new Set(userIds)].sort();
  }

  async readAuthSecurityVersion(): Promise<string> {
    const doc = await this.authSecurityVersionCollection.findOne(
      {
        _id: AUTH_SECURITY_VERSION_DOCUMENT_ID,
      },
      {
        projection: { _id: 0, version: 1 },
      },
    );

    if (!doc) {
      return BASELINE_AUTH_SECURITY_VERSION;
    }

    const version = normalizeAuthSecurityVersion(doc.version);

    if (!version) {
      throw new InfrastructureError(
        "AUTH_SECURITY_VERSION_INVALID",
        "Auth security version document is invalid",
      );
    }

    return version;
  }
}

function normalizeAuthSecurityVersion(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return normalized.length > 0 ? normalized : null;
}

function buildAuthResolutionPipeline(authSubject: string): Document[] {
  return [
    {
      $match: {
        "authLinkage.provider": "auth0",
        "authLinkage.subject": authSubject,
        "authLinkage.status": { $ne: "UNLINKED" },
      },
    },
    {
      $sort: { _id: 1 },
    },
    {
      $limit: 2,
    },
    {
      $lookup: {
        from: "role_assignments",
        let: { userId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$userId", "$$userId"] },
                  { $eq: ["$state", "ACTIVE"] },
                ],
              },
            },
          },
          {
            $sort: {
              roleId: 1,
              _id: 1,
            },
          },
          {
            $project: {
              _id: 0,
              roleId: 1,
              scopeGrants: 1,
            },
          },
        ],
        as: "activeAssignments",
      },
    },
    {
      $set: {
        assignmentRoleIds: {
          $setUnion: [
            {
              $map: {
                input: "$activeAssignments",
                as: "assignment",
                in: "$$assignment.roleId",
              },
            },
            [],
          ],
        },
      },
    },
    {
      $lookup: {
        from: "roles",
        let: { roleIds: "$assignmentRoleIds" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $in: ["$_id", "$$roleIds"] },
                  { $eq: ["$state", "ACTIVE"] },
                ],
              },
            },
          },
          {
            $sort: { _id: 1 },
          },
          {
            $project: {
              _id: 1,
              permissions: 1,
              maxDelegatableBand: 1,
            },
          },
        ],
        as: "activeRoles",
      },
    },
    {
      $set: {
        resolvedRoleIds: {
          $setUnion: [
            {
              $map: {
                input: "$activeRoles",
                as: "role",
                in: "$$role._id",
              },
            },
            [],
          ],
        },
        rolePermissions: {
          $map: {
            input: "$activeRoles",
            as: "role",
            in: "$$role.permissions",
          },
        },
        roleMaxDelegatableBands: {
          $map: {
            input: "$activeRoles",
            as: "role",
            in: "$$role.maxDelegatableBand",
          },
        },
        assignmentScopeGrants: {
          $map: {
            input: "$activeAssignments",
            as: "assignment",
            in: "$$assignment.scopeGrants",
          },
        },
      },
    },
    {
      $project: {
        _id: 1,
        actorKind: 1,
        accountStatus: 1,
        assignmentRoleIds: 1,
        resolvedRoleIds: 1,
        rolePermissions: 1,
        roleMaxDelegatableBands: 1,
        scopeGrants: 1,
        assignmentScopeGrants: 1,
      },
    },
  ];
}

function buildActivePermissionProjectionPipeline(): Document[] {
  return [
    {
      $match: {
        accountStatus: "ACTIVE",
      },
    },
    {
      $sort: { _id: 1 },
    },
    {
      $lookup: {
        from: "role_assignments",
        let: { userId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$userId", "$$userId"] },
                  { $eq: ["$state", "ACTIVE"] },
                ],
              },
            },
          },
          {
            $sort: {
              roleId: 1,
              _id: 1,
            },
          },
          {
            $project: {
              _id: 0,
              roleId: 1,
            },
          },
        ],
        as: "activeAssignments",
      },
    },
    {
      $set: {
        assignmentRoleIds: {
          $setUnion: [
            {
              $map: {
                input: "$activeAssignments",
                as: "assignment",
                in: "$$assignment.roleId",
              },
            },
            [],
          ],
        },
      },
    },
    {
      $lookup: {
        from: "roles",
        let: { roleIds: "$assignmentRoleIds" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $in: ["$_id", "$$roleIds"] },
                  { $eq: ["$state", "ACTIVE"] },
                ],
              },
            },
          },
          {
            $sort: { _id: 1 },
          },
          {
            $project: {
              _id: 1,
              permissions: 1,
              maxDelegatableBand: 1,
            },
          },
        ],
        as: "activeRoles",
      },
    },
    {
      $set: {
        resolvedRoleIds: {
          $setUnion: [
            {
              $map: {
                input: "$activeRoles",
                as: "role",
                in: "$$role._id",
              },
            },
            [],
          ],
        },
        rolePermissions: {
          $map: {
            input: "$activeRoles",
            as: "role",
            in: "$$role.permissions",
          },
        },
        roleMaxDelegatableBands: {
          $map: {
            input: "$activeRoles",
            as: "role",
            in: "$$role.maxDelegatableBand",
          },
        },
      },
    },
    {
      $project: {
        _id: 1,
        actorKind: 1,
        accountStatus: 1,
        assignmentRoleIds: 1,
        resolvedRoleIds: 1,
        rolePermissions: 1,
        roleMaxDelegatableBands: 1,
      },
    },
  ];
}

function buildActiveDelegationCeilingPipeline(userId: string): Document[] {
  return [
    {
      $match: {
        _id: userId,
        accountStatus: "ACTIVE",
      },
    },
    {
      $limit: 1,
    },
    {
      $lookup: {
        from: "role_assignments",
        let: { userId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$userId", "$$userId"] },
                  { $eq: ["$state", "ACTIVE"] },
                ],
              },
            },
          },
          {
            $sort: {
              roleId: 1,
              _id: 1,
            },
          },
          {
            $project: {
              _id: 0,
              roleId: 1,
            },
          },
        ],
        as: "activeAssignments",
      },
    },
    {
      $set: {
        assignmentRoleIds: {
          $setUnion: [
            {
              $map: {
                input: "$activeAssignments",
                as: "assignment",
                in: "$$assignment.roleId",
              },
            },
            [],
          ],
        },
      },
    },
    {
      $lookup: {
        from: "roles",
        let: { roleIds: "$assignmentRoleIds" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $in: ["$_id", "$$roleIds"] },
                  { $eq: ["$state", "ACTIVE"] },
                ],
              },
            },
          },
          {
            $sort: { _id: 1 },
          },
          {
            $project: {
              _id: 1,
              maxDelegatableBand: 1,
            },
          },
        ],
        as: "activeRoles",
      },
    },
    {
      $set: {
        resolvedRoleIds: {
          $setUnion: [
            {
              $map: {
                input: "$activeRoles",
                as: "role",
                in: "$$role._id",
              },
            },
            [],
          ],
        },
        roleMaxDelegatableBands: {
          $map: {
            input: "$activeRoles",
            as: "role",
            in: "$$role.maxDelegatableBand",
          },
        },
      },
    },
    {
      $project: {
        _id: 1,
        assignmentRoleIds: 1,
        resolvedRoleIds: 1,
        roleMaxDelegatableBands: 1,
      },
    },
  ];
}

function buildActiveRoleAssignmentProbePipeline(userId: string): Document[] {
  return [
    {
      $match: {
        _id: userId,
      },
    },
    {
      $limit: 1,
    },
    {
      $lookup: {
        from: "role_assignments",
        let: { userId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$userId", "$$userId"] },
                  { $eq: ["$state", "ACTIVE"] },
                ],
              },
            },
          },
          {
            $limit: 1,
          },
          {
            $project: {
              _id: 1,
            },
          },
        ],
        as: "activeAssignments",
      },
    },
    {
      $project: {
        _id: 0,
        hasActiveRoleAssignments: {
          $gt: [{ $size: "$activeAssignments" }, 0],
        },
      },
    },
  ];
}

function buildActiveAdminConsoleRoleCodePipeline(userId: string): Document[] {
  return [
    {
      $match: {
        _id: userId,
      },
    },
    {
      $limit: 1,
    },
    {
      $lookup: {
        from: "role_assignments",
        let: { userId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$userId", "$$userId"] },
                  { $eq: ["$state", "ACTIVE"] },
                ],
              },
            },
          },
          {
            $project: {
              _id: 0,
              roleId: 1,
            },
          },
        ],
        as: "activeAssignments",
      },
    },
    {
      $set: {
        assignmentRoleIds: {
          $setUnion: [
            {
              $map: {
                input: "$activeAssignments",
                as: "assignment",
                in: "$$assignment.roleId",
              },
            },
            [],
          ],
        },
      },
    },
    {
      $lookup: {
        from: "roles",
        let: { roleIds: "$assignmentRoleIds" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $in: ["$_id", "$$roleIds"] },
                  { $eq: ["$state", "ACTIVE"] },
                  {
                    $or: [
                      { $in: ["$code", ADMIN_CONSOLE_ROLE_CODES] },
                      { $in: ["$templateCode", ADMIN_CONSOLE_ROLE_CODES] },
                    ],
                  },
                ],
              },
            },
          },
          {
            $sort: { code: 1, _id: 1 },
          },
          {
            $project: {
              _id: 0,
              code: { $ifNull: ["$templateCode", "$code"] },
            },
          },
        ],
        as: "activeAdminConsoleRoles",
      },
    },
    {
      $project: {
        _id: 0,
        activeAdminConsoleRoleCodes: {
          $setUnion: [
            {
              $map: {
                input: "$activeAdminConsoleRoles",
                as: "role",
                in: "$$role.code",
              },
            },
            [],
          ],
        },
      },
    },
  ];
}

function toRuntimePermissionSet(
  rolePermissions: readonly unknown[] | undefined,
  userId: string,
): readonly string[] {
  if (!rolePermissions) {
    return [];
  }

  const flattened: unknown[] = [];

  for (const permissions of rolePermissions) {
    if (!Array.isArray(permissions)) {
      throw new InfrastructureError(
        "USER_AUTH_ROLE_PERMISSION_INVALID_SHAPE",
        `Invalid role permissions payload for user ${userId}`,
      );
    }

    flattened.push(...permissions);
  }

  return toSortedUniqueStrings(
    flattened,
    "USER_AUTH_ROLE_PERMISSION_INVALID_VALUE",
    `Invalid role permission value for user ${userId}`,
  );
}

function toRuntimeActorScopeGrants(
  scopeGrants: unknown,
  userId: string,
  assignmentScopeGrantPayloads?: readonly unknown[],
): ActorScopeGrants | undefined {
  const normalized: {
    workSchedule?: readonly WorkScheduleActorScopeGrant[];
    eventAssignment?: readonly EventAssignmentActorScopeGrant[];
    contractRegistry?: readonly ContractRegistryActorScopeGrant[];
    talentKpi?: readonly TalentKpiActorScopeGrant[];
    kpi?: readonly KpiActorScopeGrant[];
    revenueLedger?: readonly RevenueLedgerActorScopeGrant[];
    commission?: readonly CommissionActorScopeGrant[];
    dashboardLite?: readonly DashboardLiteActorScopeGrant[];
  } = {};

  mergeRuntimeActorScopeGrants(
    normalized,
    normalizeRuntimeActorScopeGrantsPayload(scopeGrants, userId),
  );

  for (const assignmentScopeGrants of assignmentScopeGrantPayloads ?? []) {
    mergeRuntimeActorScopeGrants(
      normalized,
      normalizeRuntimeActorScopeGrantsPayload(assignmentScopeGrants, userId),
    );
  }

  if (
    normalized.workSchedule === undefined &&
    normalized.eventAssignment === undefined &&
    normalized.contractRegistry === undefined &&
    normalized.talentKpi === undefined &&
    normalized.kpi === undefined &&
    normalized.revenueLedger === undefined &&
    normalized.commission === undefined &&
    normalized.dashboardLite === undefined
  ) {
    return undefined;
  }

  return Object.freeze(normalized);
}

function normalizeRuntimeActorScopeGrantsPayload(
  scopeGrants: unknown,
  userId: string,
): ActorScopeGrants | undefined {
  if (scopeGrants === undefined || scopeGrants === null) {
    return undefined;
  }

  if (typeof scopeGrants !== "object" || Array.isArray(scopeGrants)) {
    throw new InfrastructureError(
      "USER_AUTH_SCOPE_GRANTS_INVALID_SHAPE",
      `Invalid actor scopeGrants payload for user ${userId}`,
    );
  }

  const raw = scopeGrants as Record<string, unknown>;
  const rawWorkSchedule = raw.workSchedule;
  const rawEventAssignment = raw.eventAssignment;
  const rawContractRegistry = raw.contractRegistry;
  const rawTalentKpi = raw.talentKpi;
  const rawKpi = raw.kpi;
  const rawRevenueLedger = raw.revenueLedger;
  const rawCommission = raw.commission;
  const rawDashboardLite = raw.dashboardLite;

  const normalized: {
    workSchedule?: readonly WorkScheduleActorScopeGrant[];
    eventAssignment?: readonly EventAssignmentActorScopeGrant[];
    contractRegistry?: readonly ContractRegistryActorScopeGrant[];
    talentKpi?: readonly TalentKpiActorScopeGrant[];
    kpi?: readonly KpiActorScopeGrant[];
    revenueLedger?: readonly RevenueLedgerActorScopeGrant[];
    commission?: readonly CommissionActorScopeGrant[];
    dashboardLite?: readonly DashboardLiteActorScopeGrant[];
  } = {};

  if (rawWorkSchedule !== undefined) {
    if (!Array.isArray(rawWorkSchedule)) {
      throw new InfrastructureError(
        "USER_AUTH_SCOPE_GRANTS_INVALID_SHAPE",
        `Invalid actor workSchedule scope grants payload for user ${userId}`,
      );
    }

    const uniqueWorkScheduleScopes = new Set<WorkScheduleActorScopeGrant>();

    for (const scope of rawWorkSchedule) {
      if (
        scope !== "self" &&
        scope !== "team" &&
        scope !== "department" &&
        scope !== "global"
      ) {
        throw new InfrastructureError(
          "USER_AUTH_SCOPE_GRANTS_INVALID_VALUE",
          `Invalid actor workSchedule scope grant value for user ${userId}`,
        );
      }

      uniqueWorkScheduleScopes.add(scope as WorkScheduleActorScopeGrant);
    }

    normalized.workSchedule = Object.freeze(
      WORK_SCHEDULE_SCOPE_GRANTS_ORDER.filter((scope) =>
        uniqueWorkScheduleScopes.has(scope),
      ),
    );
  }

  if (rawEventAssignment !== undefined) {
    if (!Array.isArray(rawEventAssignment)) {
      throw new InfrastructureError(
        "USER_AUTH_SCOPE_GRANTS_INVALID_SHAPE",
        `Invalid actor eventAssignment scope grants payload for user ${userId}`,
      );
    }

    const uniqueEventAssignmentScopes =
      new Set<EventAssignmentActorScopeGrant>();

    for (const scope of rawEventAssignment) {
      if (scope !== "global" && scope !== "managedGroup") {
        throw new InfrastructureError(
          "USER_AUTH_SCOPE_GRANTS_INVALID_VALUE",
          `Invalid actor eventAssignment scope grant value for user ${userId}`,
        );
      }

      uniqueEventAssignmentScopes.add(scope as EventAssignmentActorScopeGrant);
    }

    normalized.eventAssignment = Object.freeze(
      EVENT_ASSIGNMENT_SCOPE_GRANTS_ORDER.filter((scope) =>
        uniqueEventAssignmentScopes.has(scope),
      ),
    );
  }

  if (rawContractRegistry !== undefined) {
    if (!Array.isArray(rawContractRegistry)) {
      throw new InfrastructureError(
        "USER_AUTH_SCOPE_GRANTS_INVALID_SHAPE",
        `Invalid actor contractRegistry scope grants payload for user ${userId}`,
      );
    }

    const uniqueContractRegistryScopes =
      new Set<ContractRegistryActorScopeGrant>();

    for (const scope of rawContractRegistry) {
      if (scope !== "global") {
        throw new InfrastructureError(
          "USER_AUTH_SCOPE_GRANTS_INVALID_VALUE",
          `Invalid actor contractRegistry scope grant value for user ${userId}`,
        );
      }

      uniqueContractRegistryScopes.add("global");
    }

    normalized.contractRegistry = Object.freeze(
      CONTRACT_REGISTRY_SCOPE_GRANTS_ORDER.filter((scope) =>
        uniqueContractRegistryScopes.has(scope),
      ),
    );
  }

  if (rawTalentKpi !== undefined) {
    if (!Array.isArray(rawTalentKpi)) {
      throw new InfrastructureError(
        "USER_AUTH_SCOPE_GRANTS_INVALID_SHAPE",
        `Invalid actor talentKpi scope grants payload for user ${userId}`,
      );
    }

    const uniqueTalentKpiScopes = new Set<TalentKpiActorScopeGrant>();

    for (const scope of rawTalentKpi) {
      if (scope !== "global") {
        throw new InfrastructureError(
          "USER_AUTH_SCOPE_GRANTS_INVALID_VALUE",
          `Invalid actor talentKpi scope grant value for user ${userId}`,
        );
      }

      uniqueTalentKpiScopes.add("global");
    }

    normalized.talentKpi = Object.freeze(
      TALENT_KPI_SCOPE_GRANTS_ORDER.filter((scope) =>
        uniqueTalentKpiScopes.has(scope),
      ),
    );
  }

  if (rawKpi !== undefined) {
    if (!Array.isArray(rawKpi)) {
      throw new InfrastructureError(
        "USER_AUTH_SCOPE_GRANTS_INVALID_SHAPE",
        `Invalid actor kpi scope grants payload for user ${userId}`,
      );
    }

    const uniqueKpiScopes = new Set<KpiActorScopeGrant>();

    for (const scope of rawKpi) {
      if (scope !== "global" && scope !== "managedGroup" && scope !== "self") {
        throw new InfrastructureError(
          "USER_AUTH_SCOPE_GRANTS_INVALID_VALUE",
          `Invalid actor kpi scope grant value for user ${userId}`,
        );
      }

      uniqueKpiScopes.add(scope as KpiActorScopeGrant);
    }

    normalized.kpi = Object.freeze(
      KPI_SCOPE_GRANTS_ORDER.filter((scope) => uniqueKpiScopes.has(scope)),
    );
  }

  if (rawRevenueLedger !== undefined) {
    if (!Array.isArray(rawRevenueLedger)) {
      throw new InfrastructureError(
        "USER_AUTH_SCOPE_GRANTS_INVALID_SHAPE",
        `Invalid actor revenueLedger scope grants payload for user ${userId}`,
      );
    }

    const uniqueRevenueLedgerScopes = new Set<RevenueLedgerActorScopeGrant>();

    for (const scope of rawRevenueLedger) {
      if (scope !== "global") {
        throw new InfrastructureError(
          "USER_AUTH_SCOPE_GRANTS_INVALID_VALUE",
          `Invalid actor revenueLedger scope grant value for user ${userId}`,
        );
      }

      uniqueRevenueLedgerScopes.add("global");
    }

    normalized.revenueLedger = Object.freeze(
      REVENUE_LEDGER_SCOPE_GRANTS_ORDER.filter((scope) =>
        uniqueRevenueLedgerScopes.has(scope),
      ),
    );
  }

  if (rawCommission !== undefined) {
    if (!Array.isArray(rawCommission)) {
      throw new InfrastructureError(
        "USER_AUTH_SCOPE_GRANTS_INVALID_SHAPE",
        `Invalid actor commission scope grants payload for user ${userId}`,
      );
    }

    const uniqueCommissionScopes = new Set<CommissionActorScopeGrant>();

    for (const scope of rawCommission) {
      if (scope !== "global") {
        throw new InfrastructureError(
          "USER_AUTH_SCOPE_GRANTS_INVALID_VALUE",
          `Invalid actor commission scope grant value for user ${userId}`,
        );
      }

      uniqueCommissionScopes.add("global");
    }

    normalized.commission = Object.freeze(
      COMMISSION_SCOPE_GRANTS_ORDER.filter((scope) =>
        uniqueCommissionScopes.has(scope),
      ),
    );
  }

  if (rawDashboardLite !== undefined) {
    if (!Array.isArray(rawDashboardLite)) {
      throw new InfrastructureError(
        "USER_AUTH_SCOPE_GRANTS_INVALID_SHAPE",
        `Invalid actor dashboardLite scope grants payload for user ${userId}`,
      );
    }

    const uniqueDashboardLiteScopes = new Set<DashboardLiteActorScopeGrant>();

    for (const scope of rawDashboardLite) {
      if (scope !== "global") {
        throw new InfrastructureError(
          "USER_AUTH_SCOPE_GRANTS_INVALID_VALUE",
          `Invalid actor dashboardLite scope grant value for user ${userId}`,
        );
      }

      uniqueDashboardLiteScopes.add("global");
    }

    normalized.dashboardLite = Object.freeze(
      DASHBOARD_LITE_SCOPE_GRANTS_ORDER.filter((scope) =>
        uniqueDashboardLiteScopes.has(scope),
      ),
    );
  }

  if (
    normalized.workSchedule === undefined &&
    normalized.eventAssignment === undefined &&
    normalized.contractRegistry === undefined &&
    normalized.talentKpi === undefined &&
    normalized.kpi === undefined &&
    normalized.revenueLedger === undefined &&
    normalized.commission === undefined &&
    normalized.dashboardLite === undefined
  ) {
    return undefined;
  }

  return Object.freeze(normalized);
}

function mergeRuntimeActorScopeGrants(
  target: {
    workSchedule?: readonly WorkScheduleActorScopeGrant[];
    eventAssignment?: readonly EventAssignmentActorScopeGrant[];
    contractRegistry?: readonly ContractRegistryActorScopeGrant[];
    talentKpi?: readonly TalentKpiActorScopeGrant[];
    kpi?: readonly KpiActorScopeGrant[];
    revenueLedger?: readonly RevenueLedgerActorScopeGrant[];
    commission?: readonly CommissionActorScopeGrant[];
    dashboardLite?: readonly DashboardLiteActorScopeGrant[];
  },
  source: ActorScopeGrants | undefined,
): void {
  if (!source) {
    return;
  }

  const workSchedule = mergeOrderedScopeGrants(
    target.workSchedule,
    source.workSchedule,
    WORK_SCHEDULE_SCOPE_GRANTS_ORDER,
  );
  if (workSchedule !== undefined) {
    target.workSchedule = workSchedule;
  }

  const eventAssignment = mergeOrderedScopeGrants(
    target.eventAssignment,
    source.eventAssignment,
    EVENT_ASSIGNMENT_SCOPE_GRANTS_ORDER,
  );
  if (eventAssignment !== undefined) {
    target.eventAssignment = eventAssignment;
  }

  const contractRegistry = mergeOrderedScopeGrants(
    target.contractRegistry,
    source.contractRegistry,
    CONTRACT_REGISTRY_SCOPE_GRANTS_ORDER,
  );
  if (contractRegistry !== undefined) {
    target.contractRegistry = contractRegistry;
  }

  const talentKpi = mergeOrderedScopeGrants(
    target.talentKpi,
    source.talentKpi,
    TALENT_KPI_SCOPE_GRANTS_ORDER,
  );
  if (talentKpi !== undefined) {
    target.talentKpi = talentKpi;
  }

  const kpi = mergeOrderedScopeGrants(
    target.kpi,
    source.kpi,
    KPI_SCOPE_GRANTS_ORDER,
  );
  if (kpi !== undefined) {
    target.kpi = kpi;
  }

  const revenueLedger = mergeOrderedScopeGrants(
    target.revenueLedger,
    source.revenueLedger,
    REVENUE_LEDGER_SCOPE_GRANTS_ORDER,
  );
  if (revenueLedger !== undefined) {
    target.revenueLedger = revenueLedger;
  }

  const commission = mergeOrderedScopeGrants(
    target.commission,
    source.commission,
    COMMISSION_SCOPE_GRANTS_ORDER,
  );
  if (commission !== undefined) {
    target.commission = commission;
  }

  const dashboardLite = mergeOrderedScopeGrants(
    target.dashboardLite,
    source.dashboardLite,
    DASHBOARD_LITE_SCOPE_GRANTS_ORDER,
  );
  if (dashboardLite !== undefined) {
    target.dashboardLite = dashboardLite;
  }
}

function mergeOrderedScopeGrants<T extends string>(
  current: readonly T[] | undefined,
  incoming: readonly T[] | undefined,
  order: readonly T[],
): readonly T[] | undefined {
  if (!incoming || incoming.length === 0) {
    return current;
  }

  const merged = new Set<T>(current ?? []);
  for (const scope of incoming) {
    merged.add(scope);
  }

  return Object.freeze(order.filter((scope) => merged.has(scope)));
}

function toRuntimeDelegationCeilingSet(
  values: readonly unknown[] | undefined,
  userId: string,
): readonly RoleMaxDelegatableBandForCapability[] {
  if (!values) {
    return [];
  }

  const unique = new Set<RoleMaxDelegatableBandForCapability>();

  for (const value of values) {
    if (value === undefined || value === null) {
      unique.add("NONE");
      continue;
    }

    if (value !== "NONE" && value !== "LIMITED" && value !== "PRIVILEGED") {
      throw new InfrastructureError(
        "USER_AUTH_ROLE_DELEGATION_BAND_INVALID_VALUE",
        `Invalid role maxDelegatableBand value for user ${userId}`,
      );
    }

    unique.add(value);
  }

  return [...unique].sort(compareDelegatableBand);
}

function compareDelegatableBand(
  left: RoleMaxDelegatableBandForCapability,
  right: RoleMaxDelegatableBandForCapability,
): number {
  return toDelegatableBandRank(left) - toDelegatableBandRank(right);
}

function toDelegatableBandRank(
  value: RoleMaxDelegatableBandForCapability,
): number {
  if (value === "NONE") {
    return 0;
  }

  if (value === "LIMITED") {
    return 1;
  }

  return 2;
}

function isDelegatableBandAtLeast(
  current: RoleMaxDelegatableBandForCapability,
  minimum: RoleMaxDelegatableBandForCapability,
): boolean {
  return toDelegatableBandRank(current) >= toDelegatableBandRank(minimum);
}

function assertDelegatableBand(
  value: RoleMaxDelegatableBandForCapability,
): void {
  if (value === "NONE" || value === "LIMITED" || value === "PRIVILEGED") {
    return;
  }

  throw new InfrastructureError(
    "USER_AUTH_ROLE_DELEGATION_BAND_INVALID_VALUE",
    "Delegation band must be NONE, LIMITED, or PRIVILEGED",
  );
}

function toSortedUniqueStrings(
  values: readonly unknown[] | undefined,
  code: string,
  message: string,
): readonly string[] {
  if (!values) {
    return [];
  }

  const unique = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string") {
      throw new InfrastructureError(code, message);
    }

    unique.add(value);
  }

  return [...unique].sort();
}

function normalizePermissionCodes(codes: readonly string[]): readonly string[] {
  const unique = new Set<string>();

  for (const code of codes) {
    if (typeof code !== "string") {
      throw new InfrastructureError(
        "USER_AUTH_ROLE_PERMISSION_INVALID_VALUE",
        "Permission code must be a string",
      );
    }

    const normalized = code.trim();

    if (!normalized) {
      throw new InfrastructureError(
        "USER_AUTH_ROLE_PERMISSION_INVALID_VALUE",
        "Permission code must not be empty",
      );
    }

    unique.add(normalized);
  }

  return [...unique].sort();
}

function initializePermissionUserMap(
  permissionCodes: readonly string[],
): Record<string, string[]> {
  const map: Record<string, string[]> = {};

  for (const permissionCode of permissionCodes) {
    map[permissionCode] = [];
  }

  return map;
}

function finalizePermissionUserMap(
  map: Record<string, string[]>,
): Readonly<Record<string, readonly string[]>> {
  const finalized: Record<string, readonly string[]> = {};

  for (const [permissionCode, userIds] of Object.entries(map)) {
    finalized[permissionCode] = [...new Set(userIds)].sort();
  }

  return finalized;
}

function assertNoUnresolvedRoleAssignments(
  userId: string,
  assignmentRoleIds: readonly string[],
  resolvedRoleIds: readonly string[],
): void {
  const resolvedRoleIdSet = new Set(resolvedRoleIds);
  const unresolvedRoleIds = assignmentRoleIds.filter(
    (roleId) => !resolvedRoleIdSet.has(roleId),
  );

  if (unresolvedRoleIds.length === 0) {
    return;
  }

  throw new InfrastructureError(
    "USER_AUTH_ROLE_RESOLUTION_INTEGRITY_VIOLATION",
    `Active role assignments point to missing or inactive roles for user ${userId}: ${unresolvedRoleIds.join(",")}`,
  );
}

function coerceHasActiveRoleAssignmentFlag(
  value: unknown,
  userId: string,
): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  throw new InfrastructureError(
    "USER_AUTH_ACTIVE_ASSIGNMENT_INVALID_SHAPE",
    `Invalid active role assignment projection for user ${userId}`,
  );
}
