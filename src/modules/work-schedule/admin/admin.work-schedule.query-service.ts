import { Actor } from "@core/actor/actor";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import {
  WorkScheduleNotFoundError,
  WorkSchedulePermissionScopeError,
  WorkScheduleValidationError,
} from "@modules/work-schedule/domain/work-schedule.errors";
import { WorkScheduleEmploymentProfileReadonlyAccess } from "@modules/work-schedule/domain/work-schedule-employment-profile-readonly-access";
import {
  WORK_SHIFT_SCOPES,
  WORK_SHIFT_SOURCE_TYPES,
  WORK_SHIFT_SORT_DIRECTIONS,
  WORK_SHIFT_SORT_FIELDS,
  WORK_SHIFT_STATUSES,
  WORK_SHIFT_SUBJECT_KINDS,
  WorkShiftScope,
  WorkShiftSortDirection,
  WorkShiftSortField,
  WorkShiftSourceType,
  WorkShiftStatus,
  WorkShiftSubjectKind,
} from "@modules/work-schedule/domain/work-schedule.types";
import { WorkShiftReadRepository } from "@modules/work-schedule/read/work-schedule.read-repository";
import {
  GetWorkShiftDetailQuery,
  GetWorkShiftDetailResult,
  ListWorkShiftsByResourceQuery,
  ListWorkShiftsByResourceResult,
  ListWorkShiftsBySubjectQuery,
  ListWorkShiftsBySubjectResult,
  ListWorkShiftsQuery,
  ListWorkShiftsResult,
} from "@modules/work-schedule/shared/work-schedule.contracts";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface ParsedSubjectFilter {
  readonly subjectKind?: WorkShiftSubjectKind;
  readonly subjectEmploymentProfileId?: string;
  readonly subjectTalentId?: string;
  readonly subjectTalentGroupId?: string;
}

interface ParsedExactSubject {
  readonly subjectKind: WorkShiftSubjectKind;
  readonly subjectEmploymentProfileId: string | null;
  readonly subjectTalentId: string | null;
  readonly subjectTalentGroupId: string | null;
}

interface ParsedWindowFilter {
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
}

export class WorkScheduleAdminQueryService {
  constructor(
    private readonly readRepository: WorkShiftReadRepository,
    private readonly employmentProfileReadonlyAccess: WorkScheduleEmploymentProfileReadonlyAccess,
  ) {}

  async listWorkShifts(
    actor: Actor,
    query: ListWorkShiftsQuery,
  ): Promise<ListWorkShiftsResult> {
    this.assertReadPermission(actor);

    const subjectFilter = parseSubjectFilter({
      subjectKind: query.subjectKind,
      subjectEmploymentProfileId:
        query.subjectEmploymentProfileId,
      subjectTalentId:
        query.subjectTalentId,
      subjectTalentGroupId:
        query.subjectTalentGroupId,
    });
    const requestedScope = parseRequestedScope(
      query.scope,
    );
    const scopeEmploymentProfileIds =
      await this.resolveScopeEmploymentProfileIdsForList(
        actor,
        requestedScope,
        subjectFilter,
      );
    const window = parseWindowFilter({
      windowStartAt: query.windowStartAt,
      windowEndAt: query.windowEndAt,
    });

    return this.readRepository.listWorkShifts({
      status: parseOptionalStatus(query.status),
      subjectKind: subjectFilter.subjectKind,
      subjectEmploymentProfileId:
        subjectFilter.subjectEmploymentProfileId,
      subjectTalentId:
        subjectFilter.subjectTalentId,
      subjectTalentGroupId:
        subjectFilter.subjectTalentGroupId,
      containsStudioResourceId: parseOptionalId(
        query.containsStudioResourceId,
        "containsStudioResourceId",
      ),
      sourceType: parseOptionalSourceType(
        query.sourceType,
      ),
      sourceRosterId: parseOptionalId(
        query.sourceRosterId,
        "sourceRosterId",
      ),
      sourceDepartmentOrgUnitId: parseOptionalId(
        query.sourceDepartmentOrgUnitId,
        "sourceDepartmentOrgUnitId",
      ),
      sourceRosterMonth: parseOptionalRosterMonth(
        query.sourceRosterMonth,
      ),
      windowStartAt: window.windowStartAt,
      windowEndAt: window.windowEndAt,
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
      search: parseOptionalSearch(query.search),
      sortField: parseOptionalSortField(
        query.sortBy,
      ),
      sortDirection: parseOptionalSortDirection(
        query.sortDirection,
      ),
      scopeEmploymentProfileIds,
    });
  }

  async listWorkShiftsBySubject(
    actor: Actor,
    query: ListWorkShiftsBySubjectQuery,
  ): Promise<ListWorkShiftsBySubjectResult> {
    this.assertReadPermission(actor);

    const subject =
      parseExactSubjectQuery(query);
    const requestedScope = parseRequestedScope(
      query.scope,
    );
    const scope =
      await this.resolveEffectiveScopeForExactSubject(
        actor,
        requestedScope,
        subject,
      );
    const window = parseWindowFilter({
      windowStartAt: query.windowStartAt,
      windowEndAt: query.windowEndAt,
    });

    let scopeEmploymentProfileIds:
      | readonly string[]
      | undefined;

    if (scope !== "global") {
      await this.assertEmploymentProfileScopeAccess(
        actor,
        scope,
        subject,
      );
      scopeEmploymentProfileIds = [
        subject.subjectEmploymentProfileId as string,
      ];
    }

    return this.readRepository.listWorkShiftsBySubject(
      {
        subjectKind: subject.subjectKind,
        subjectEmploymentProfileId:
          subject.subjectEmploymentProfileId,
        subjectTalentId:
          subject.subjectTalentId,
        subjectTalentGroupId:
          subject.subjectTalentGroupId,
        status: parseOptionalStatus(query.status),
        windowStartAt: window.windowStartAt,
        windowEndAt: window.windowEndAt,
        limit: parseLimit(query.limit),
        cursor: parseOptionalCursor(query.cursor),
        sortField: parseOptionalSortField(
          query.sortBy,
        ),
        sortDirection:
          parseOptionalSortDirection(
            query.sortDirection,
          ),
        scopeEmploymentProfileIds,
      },
    );
  }

  async listWorkShiftsByResource(
    actor: Actor,
    query: ListWorkShiftsByResourceQuery,
  ): Promise<ListWorkShiftsByResourceResult> {
    this.assertReadPermission(actor);

    const requestedScope = parseRequestedScope(
      query.scope,
    );
    const scopeEmploymentProfileIds =
      await this.resolveScopeEmploymentProfileIdsForResourceQuery(
        actor,
        requestedScope,
      );
    const window = parseWindowFilter({
      windowStartAt: query.windowStartAt,
      windowEndAt: query.windowEndAt,
    });

    return this.readRepository.listWorkShiftsByResource(
      {
        studioResourceId:
          normalizeRequiredText(
            query.studioResourceId,
            "studioResourceId",
          ),
        status: parseOptionalStatus(query.status),
        windowStartAt: window.windowStartAt,
        windowEndAt: window.windowEndAt,
        limit: parseLimit(query.limit),
        cursor: parseOptionalCursor(query.cursor),
        sortField: parseOptionalSortField(
          query.sortBy,
        ),
        sortDirection:
          parseOptionalSortDirection(
            query.sortDirection,
          ),
        scopeEmploymentProfileIds,
      },
    );
  }

  async getWorkShiftDetail(
    actor: Actor,
    query: GetWorkShiftDetailQuery,
  ): Promise<GetWorkShiftDetailResult> {
    this.assertReadPermission(actor);

    const workShiftId = normalizeRequiredText(
      query.workShiftId,
      "workShiftId",
    );
    const detail =
      await this.readRepository.getWorkShiftDetail(
        workShiftId,
      );

    if (!detail) {
      throw new WorkScheduleNotFoundError(
        workShiftId,
      );
    }

    const requestedScope = parseRequestedScope(
      query.scope,
    );
    const scope =
      await this.resolveEffectiveScopeForExactSubject(
        actor,
        requestedScope,
        {
          subjectKind: detail.subjectKind,
          subjectEmploymentProfileId:
            detail.subjectEmploymentProfileId,
          subjectTalentId:
            detail.subjectTalentId,
          subjectTalentGroupId:
            detail.subjectTalentGroupId,
        },
      );

    if (scope !== "global") {
      await this.assertEmploymentProfileScopeAccess(
        actor,
        scope,
        {
          subjectKind: detail.subjectKind,
          subjectEmploymentProfileId:
            detail.subjectEmploymentProfileId,
          subjectTalentId:
            detail.subjectTalentId,
          subjectTalentGroupId:
            detail.subjectTalentGroupId,
        },
      );
    }

    return detail;
  }

  private async resolveEffectiveScopeForExactSubject(
    actor: Actor,
    requestedScope: WorkShiftScope | undefined,
    subject: ParsedExactSubject,
  ): Promise<WorkShiftScope> {
    if (requestedScope) {
      if (
        PermissionGuard.hasWorkScheduleScopeGrant(
          actor,
          requestedScope,
        )
      ) {
        return requestedScope;
      }

      throw new WorkSchedulePermissionScopeError(
        `Scope ${requestedScope} is not authorized for actor`,
      );
    }

    for (const candidate of [
      "self",
      "team",
      "department",
    ] as const) {
      if (
        !PermissionGuard.hasWorkScheduleScopeGrant(
          actor,
          candidate,
        )
      ) {
        continue;
      }

      try {
        await this.assertEmploymentProfileScopeAccess(
          actor,
          candidate,
          subject,
        );
        return candidate;
      } catch (error) {
        if (
          !(
            error instanceof
            WorkSchedulePermissionScopeError
          )
        ) {
          throw error;
        }
      }
    }

    if (
      PermissionGuard.hasWorkScheduleScopeGrant(
        actor,
        "global",
      )
    ) {
      return "global";
    }

    throw new WorkSchedulePermissionScopeError(
      "scope could not be resolved for actor and requested subject",
    );
  }

  private async resolveScopeEmploymentProfileIdsForList(
    actor: Actor,
    requestedScope: WorkShiftScope | undefined,
    subjectFilter: ParsedSubjectFilter,
  ): Promise<readonly string[] | undefined> {
    const hasNonEmploymentProfileSubjectFilter =
      subjectFilter.subjectKind === "TALENT" ||
      subjectFilter.subjectKind ===
        "TALENT_GROUP" ||
      subjectFilter.subjectTalentId !==
        undefined ||
      subjectFilter.subjectTalentGroupId !==
        undefined;

    if (requestedScope) {
      if (
        !PermissionGuard.hasWorkScheduleScopeGrant(
          actor,
          requestedScope,
        )
      ) {
        throw new WorkSchedulePermissionScopeError(
          `Scope ${requestedScope} is not authorized for actor`,
        );
      }

      if (requestedScope === "global") {
        return undefined;
      }

      if (hasNonEmploymentProfileSubjectFilter) {
        throw new WorkSchedulePermissionScopeError(
          "Non-global scope cannot read TALENT or TALENT_GROUP shifts in Phase 1",
        );
      }

      const actorProfile =
        await this.requireActorLinkedEmploymentProfile(
          actor.id,
        );

      return resolveScopedEmploymentProfileIds({
        scope: requestedScope,
        actorEmploymentProfileId:
          actorProfile.id,
        actorOrgUnitId:
          actorProfile.orgUnitId,
        employmentProfileReadonlyAccess:
          this.employmentProfileReadonlyAccess,
      });
    }

    if (
      PermissionGuard.hasWorkScheduleScopeGrant(
        actor,
        "global",
      )
    ) {
      return undefined;
    }

    if (hasNonEmploymentProfileSubjectFilter) {
      throw new WorkSchedulePermissionScopeError(
        "scope could not be resolved for TALENT or TALENT_GROUP query without global grant",
      );
    }

    const grantedNonGlobalScopes = [
      "self",
      "team",
      "department",
    ].filter((scope) =>
      PermissionGuard.hasWorkScheduleScopeGrant(
        actor,
        scope as Exclude<
          WorkShiftScope,
          "global"
        >,
      ),
    ) as Exclude<
      WorkShiftScope,
      "global"
    >[];

    if (grantedNonGlobalScopes.length === 0) {
      throw new WorkSchedulePermissionScopeError(
        "scope could not be resolved for actor",
      );
    }

    const actorProfile =
      await this.requireActorLinkedEmploymentProfile(
        actor.id,
      );
    const aggregatedIds = new Set<string>();

    for (const scope of grantedNonGlobalScopes) {
      const scopedIds =
        await resolveScopedEmploymentProfileIds({
          scope,
          actorEmploymentProfileId:
            actorProfile.id,
          actorOrgUnitId:
            actorProfile.orgUnitId,
          employmentProfileReadonlyAccess:
            this.employmentProfileReadonlyAccess,
        });

      for (const id of scopedIds) {
        aggregatedIds.add(id);
      }
    }

    if (aggregatedIds.size === 0) {
      throw new WorkSchedulePermissionScopeError(
        "scope could not be resolved for actor",
      );
    }

    return [...aggregatedIds].sort();
  }

  private async resolveScopeEmploymentProfileIdsForResourceQuery(
    actor: Actor,
    requestedScope: WorkShiftScope | undefined,
  ): Promise<readonly string[] | undefined> {
    if (requestedScope) {
      if (
        !PermissionGuard.hasWorkScheduleScopeGrant(
          actor,
          requestedScope,
        )
      ) {
        throw new WorkSchedulePermissionScopeError(
          `Scope ${requestedScope} is not authorized for actor`,
        );
      }

      if (requestedScope === "global") {
        return undefined;
      }

      const actorProfile =
        await this.requireActorLinkedEmploymentProfile(
          actor.id,
        );

      return resolveScopedEmploymentProfileIds({
        scope: requestedScope,
        actorEmploymentProfileId:
          actorProfile.id,
        actorOrgUnitId:
          actorProfile.orgUnitId,
        employmentProfileReadonlyAccess:
          this.employmentProfileReadonlyAccess,
      });
    }

    if (
      PermissionGuard.hasWorkScheduleScopeGrant(
        actor,
        "global",
      )
    ) {
      return undefined;
    }

    const grantedNonGlobalScopes = [
      "self",
      "team",
      "department",
    ].filter((scope) =>
      PermissionGuard.hasWorkScheduleScopeGrant(
        actor,
        scope as Exclude<
          WorkShiftScope,
          "global"
        >,
      ),
    ) as Exclude<
      WorkShiftScope,
      "global"
    >[];

    if (grantedNonGlobalScopes.length === 0) {
      throw new WorkSchedulePermissionScopeError(
        "scope could not be resolved for actor",
      );
    }

    const actorProfile =
      await this.requireActorLinkedEmploymentProfile(
        actor.id,
      );
    const aggregatedIds = new Set<string>();

    for (const scope of grantedNonGlobalScopes) {
      const scopedIds =
        await resolveScopedEmploymentProfileIds({
          scope,
          actorEmploymentProfileId:
            actorProfile.id,
          actorOrgUnitId:
            actorProfile.orgUnitId,
          employmentProfileReadonlyAccess:
            this.employmentProfileReadonlyAccess,
        });

      for (const id of scopedIds) {
        aggregatedIds.add(id);
      }
    }

    if (aggregatedIds.size === 0) {
      throw new WorkSchedulePermissionScopeError(
        "scope could not be resolved for actor",
      );
    }

    return [...aggregatedIds].sort();
  }

  private assertReadPermission(actor: Actor): void {
    assertAdminActorType(actor);

    const permission =
      PermissionResolver.resolve(
        Permission.WORK_SCHEDULE_READ,
      );
    PermissionGuard.assert(actor, permission);
  }

  private async assertEmploymentProfileScopeAccess(
    actor: Actor,
    scope: WorkShiftScope,
    subject: {
      readonly subjectKind: WorkShiftSubjectKind;
      readonly subjectEmploymentProfileId: string | null;
      readonly subjectTalentId: string | null;
      readonly subjectTalentGroupId: string | null;
    },
  ): Promise<void> {
    if (scope === "global") {
      return;
    }

    if (
      subject.subjectKind !==
        "EMPLOYMENT_PROFILE" ||
      !subject.subjectEmploymentProfileId
    ) {
      throw new WorkSchedulePermissionScopeError(
        "Non-global scope cannot access TALENT or TALENT_GROUP shifts in Phase 1",
      );
    }

    const actorProfile =
      await this.requireActorLinkedEmploymentProfile(
        actor.id,
      );
    const targetProfile =
      await this.employmentProfileReadonlyAccess.findById(
        subject.subjectEmploymentProfileId,
      );

    if (!targetProfile) {
      throw new WorkSchedulePermissionScopeError(
        "Scope resolution target employment profile is missing",
      );
    }

    switch (scope) {
      case "self":
        if (targetProfile.id === actorProfile.id) {
          return;
        }
        break;

      case "team":
        if (
          targetProfile.managerEmploymentProfileId ===
          actorProfile.id
        ) {
          return;
        }
        break;

      case "department":
        if (
          targetProfile.orgUnitId ===
          actorProfile.orgUnitId
        ) {
          return;
        }
        break;
    }

    throw new WorkSchedulePermissionScopeError(
      `Scope ${scope} does not allow access to the requested employment-profile subject`,
    );
  }

  private async requireActorLinkedEmploymentProfile(
    actorId: string,
  ) {
    const actorProfile =
      await this.employmentProfileReadonlyAccess.findByLinkedUserId(
        actorId,
      );

    if (!actorProfile) {
      throw new WorkSchedulePermissionScopeError(
        "Actor-linked employment profile is required for self/team/department scope",
      );
    }

    return actorProfile;
  }
}

async function resolveScopedEmploymentProfileIds(params: {
  readonly scope: Exclude<
    WorkShiftScope,
    "global"
  >;
  readonly actorEmploymentProfileId: string;
  readonly actorOrgUnitId: string;
  readonly employmentProfileReadonlyAccess: WorkScheduleEmploymentProfileReadonlyAccess;
}): Promise<readonly string[]> {
  if (params.scope === "self") {
    return [params.actorEmploymentProfileId];
  }

  const sourceIds =
    params.scope === "team"
      ? await params.employmentProfileReadonlyAccess.listIdsByManagerEmploymentProfileId(
          params.actorEmploymentProfileId,
        )
      : await params.employmentProfileReadonlyAccess.listIdsByOrgUnitId(
          params.actorOrgUnitId,
        );

  return [...new Set(sourceIds)].sort();
}

function normalizeRequiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new WorkScheduleValidationError(
      `${field} is required`,
    );
  }

  return normalized;
}

function parseOptionalId(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();
  return normalized.length > 0
    ? normalized
    : undefined;
}

function parseOptionalStatus(
  value: unknown,
): WorkShiftStatus | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `status must be one of ${WORK_SHIFT_STATUSES.join(", ")}`,
    );
  }

  const normalized = value
    .trim()
    .toUpperCase();

  if (
    WORK_SHIFT_STATUSES.includes(
      normalized as WorkShiftStatus,
    )
  ) {
    return normalized as WorkShiftStatus;
  }

  throw new WorkScheduleValidationError(
    `status must be one of ${WORK_SHIFT_STATUSES.join(", ")}`,
  );
}

function parseSubjectFilter(input: {
  readonly subjectKind: unknown;
  readonly subjectEmploymentProfileId: unknown;
  readonly subjectTalentId: unknown;
  readonly subjectTalentGroupId: unknown;
}): ParsedSubjectFilter {
  const subjectKind =
    parseOptionalSubjectKind(
      input.subjectKind,
    );
  const subjectEmploymentProfileId =
    parseOptionalId(
      input.subjectEmploymentProfileId,
      "subjectEmploymentProfileId",
    );
  const subjectTalentId = parseOptionalId(
    input.subjectTalentId,
    "subjectTalentId",
  );
  const subjectTalentGroupId =
    parseOptionalId(
      input.subjectTalentGroupId,
      "subjectTalentGroupId",
    );
  const providedSubjectIds = [
    subjectEmploymentProfileId,
    subjectTalentId,
    subjectTalentGroupId,
  ].filter((value) => value !== undefined);

  if (providedSubjectIds.length > 1) {
    throw new WorkScheduleValidationError(
      "At most one subject-id filter may be provided",
    );
  }

  if (subjectKind) {
    if (
      subjectKind ===
        "EMPLOYMENT_PROFILE" &&
      (subjectTalentId !== undefined ||
        subjectTalentGroupId !== undefined)
    ) {
      throw new WorkScheduleValidationError(
        "subjectKind EMPLOYMENT_PROFILE is inconsistent with subjectTalentId/subjectTalentGroupId filter",
      );
    }

    if (
      subjectKind === "TALENT" &&
      (subjectEmploymentProfileId !==
        undefined ||
        subjectTalentGroupId !== undefined)
    ) {
      throw new WorkScheduleValidationError(
        "subjectKind TALENT is inconsistent with subjectEmploymentProfileId/subjectTalentGroupId filter",
      );
    }

    if (
      subjectKind === "TALENT_GROUP" &&
      (subjectEmploymentProfileId !==
        undefined ||
        subjectTalentId !== undefined)
    ) {
      throw new WorkScheduleValidationError(
        "subjectKind TALENT_GROUP is inconsistent with subjectEmploymentProfileId/subjectTalentId filter",
      );
    }
  }

  return {
    subjectKind,
    subjectEmploymentProfileId,
    subjectTalentId,
    subjectTalentGroupId,
  };
}

function parseExactSubjectQuery(
  query: ListWorkShiftsBySubjectQuery,
): ParsedExactSubject {
  const subjectKind =
    parseRequiredSubjectKind(
      query.subjectKind,
    );
  const subjectEmploymentProfileId =
    parseOptionalId(
      query.subjectEmploymentProfileId,
      "subjectEmploymentProfileId",
    );
  const subjectTalentId = parseOptionalId(
    query.subjectTalentId,
    "subjectTalentId",
  );
  const subjectTalentGroupId =
    parseOptionalId(
      query.subjectTalentGroupId,
      "subjectTalentGroupId",
    );

  if (
    subjectKind ===
      "EMPLOYMENT_PROFILE" &&
    subjectEmploymentProfileId &&
    !subjectTalentId &&
    !subjectTalentGroupId
  ) {
    return {
      subjectKind,
      subjectEmploymentProfileId,
      subjectTalentId: null,
      subjectTalentGroupId: null,
    };
  }

  if (
    subjectKind === "TALENT" &&
    subjectTalentId &&
    !subjectEmploymentProfileId &&
    !subjectTalentGroupId
  ) {
    return {
      subjectKind,
      subjectEmploymentProfileId: null,
      subjectTalentId,
      subjectTalentGroupId: null,
    };
  }

  if (
    subjectKind === "TALENT_GROUP" &&
    subjectTalentGroupId &&
    !subjectEmploymentProfileId &&
    !subjectTalentId
  ) {
    return {
      subjectKind,
      subjectEmploymentProfileId: null,
      subjectTalentId: null,
      subjectTalentGroupId,
    };
  }

  throw new WorkScheduleValidationError(
    "listWorkShiftsBySubject requires exactly one subject reference matching subjectKind",
  );
}

function parseOptionalSubjectKind(
  value: unknown,
): WorkShiftSubjectKind | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return parseRequiredSubjectKind(value);
}

function parseRequiredSubjectKind(
  value: unknown,
): WorkShiftSubjectKind {
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `subjectKind must be one of ${WORK_SHIFT_SUBJECT_KINDS.join(", ")}`,
    );
  }

  const normalized = value
    .trim()
    .toUpperCase();

  if (
    WORK_SHIFT_SUBJECT_KINDS.includes(
      normalized as WorkShiftSubjectKind,
    )
  ) {
    return normalized as WorkShiftSubjectKind;
  }

  throw new WorkScheduleValidationError(
    `subjectKind must be one of ${WORK_SHIFT_SUBJECT_KINDS.join(", ")}`,
  );
}

function parseWindowFilter(input: {
  readonly windowStartAt: unknown;
  readonly windowEndAt: unknown;
}): ParsedWindowFilter {
  const windowStartAt =
    parseOptionalTimestamp(
      input.windowStartAt,
      "windowStartAt",
    );
  const windowEndAt = parseOptionalTimestamp(
    input.windowEndAt,
    "windowEndAt",
  );

  if (
    windowStartAt !== undefined &&
    windowEndAt !== undefined &&
    windowEndAt <= windowStartAt
  ) {
    throw new WorkScheduleValidationError(
      "windowEndAt must be strictly later than windowStartAt",
    );
  }

  return {
    windowStartAt,
    windowEndAt,
  };
}

function parseLimit(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }

  const numeric = parseOptionalInteger(
    value,
    "limit",
  );

  if (numeric === undefined) {
    return DEFAULT_LIMIT;
  }

  if (numeric <= 0) {
    throw new WorkScheduleValidationError(
      "limit must be a positive integer",
    );
  }

  return Math.min(numeric, MAX_LIMIT);
}

function parseOptionalInteger(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  let numeric: number;

  if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "string") {
    if (!value.trim()) {
      return undefined;
    }

    numeric = Number(value);
  } else {
    throw new WorkScheduleValidationError(
      `${field} must be an integer`,
    );
  }

  if (!Number.isInteger(numeric)) {
    throw new WorkScheduleValidationError(
      `${field} must be an integer`,
    );
  }

  return numeric;
}

function parseOptionalTimestamp(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const parsed = parseOptionalInteger(
    value,
    field,
  );

  if (parsed === undefined) {
    return undefined;
  }

  return parsed;
}

function parseOptionalCursor(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      "cursor must be a string",
    );
  }

  const normalized = value.trim();
  return normalized.length > 0
    ? normalized
    : undefined;
}

function parseOptionalSearch(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      "search must be a string",
    );
  }

  const normalized = value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();

  return normalized.length > 0
    ? normalized
    : undefined;
}

function parseOptionalSortField(
  value: unknown,
): WorkShiftSortField | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `sortBy must be one of ${WORK_SHIFT_SORT_FIELDS.join(", ")}`,
    );
  }

  const normalized = value.trim();

  if (
    WORK_SHIFT_SORT_FIELDS.includes(
      normalized as WorkShiftSortField,
    )
  ) {
    return normalized as WorkShiftSortField;
  }

  throw new WorkScheduleValidationError(
    `sortBy must be one of ${WORK_SHIFT_SORT_FIELDS.join(", ")}`,
  );
}

function parseOptionalSortDirection(
  value: unknown,
): WorkShiftSortDirection | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `sortDirection must be one of ${WORK_SHIFT_SORT_DIRECTIONS.join(", ")}`,
    );
  }

  const normalized = value
    .trim()
    .toUpperCase();

  if (
    WORK_SHIFT_SORT_DIRECTIONS.includes(
      normalized as WorkShiftSortDirection,
    )
  ) {
    return normalized as WorkShiftSortDirection;
  }

  throw new WorkScheduleValidationError(
    `sortDirection must be one of ${WORK_SHIFT_SORT_DIRECTIONS.join(", ")}`,
  );
}

function parseRequestedScope(
  value: unknown,
): WorkShiftScope | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `scope must be one of ${WORK_SHIFT_SCOPES.join(", ")}`,
    );
  }

  const normalized = value
    .trim()
    .toLowerCase();

  if (
    WORK_SHIFT_SCOPES.includes(
      normalized as WorkShiftScope,
    )
  ) {
    return normalized as WorkShiftScope;
  }

  throw new WorkScheduleValidationError(
    `scope must be one of ${WORK_SHIFT_SCOPES.join(", ")}`,
  );
}

function assertAdminActorType(
  actor: Actor,
): void {
  if (actor.type === "admin") {
    return;
  }

  throw new SystemInvariantError(
    "PERMISSION_DENIED",
    `Work schedule access requires actor.type admin, received ${actor.type}`,
  );
}

function parseOptionalSourceType(
  value: unknown,
): WorkShiftSourceType | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `sourceType must be one of ${WORK_SHIFT_SOURCE_TYPES.join(", ")}`,
    );
  }

  const normalized = value
    .trim()
    .toUpperCase();

  if (
    WORK_SHIFT_SOURCE_TYPES.includes(
      normalized as WorkShiftSourceType,
    )
  ) {
    return normalized as WorkShiftSourceType;
  }

  throw new WorkScheduleValidationError(
    `sourceType must be one of ${WORK_SHIFT_SOURCE_TYPES.join(", ")}`,
  );
}

function parseOptionalRosterMonth(
  value: unknown,
): string | undefined {
  const normalized = parseOptionalId(
    value,
    "sourceRosterMonth",
  );

  if (normalized === undefined) {
    return undefined;
  }

  if (!/^\d{4}-\d{2}$/u.test(normalized)) {
    throw new WorkScheduleValidationError(
      "sourceRosterMonth must use YYYY-MM format",
    );
  }

  return normalized;
}
