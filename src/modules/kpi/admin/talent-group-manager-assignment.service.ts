import crypto from "crypto";
import { Actor } from "@core/actor/actor";
import { KpiValidationError } from "@modules/kpi/domain/kpi.errors";
import { TalentGroupManagerAssignmentRepository } from "@modules/kpi/domain/talent-group-manager-assignment.repository";
import {
  TALENT_GROUP_MANAGER_ASSIGNMENT_STATUSES,
  TALENT_GROUP_MANAGER_ROLES,
  TalentGroupManagerAssignment,
  TalentGroupManagerAssignmentStatus,
  TalentGroupManagerRole,
} from "@modules/kpi/domain/kpi.types";

export interface CreateTalentGroupManagerAssignmentCommand {
  readonly groupId: string;
  readonly managerEmploymentProfileId: string;
  readonly role: TalentGroupManagerRole | string;
  readonly effectiveFrom: number;
  readonly effectiveTo?: number | null;
  readonly status?: TalentGroupManagerAssignmentStatus | string;
  readonly isPrimary?: boolean;
}

export class TalentGroupManagerAssignmentService {
  constructor(
    private readonly repository: TalentGroupManagerAssignmentRepository,
    private readonly clock: () => number = Date.now,
  ) {}

  async createAssignment(
    actor: Actor,
    command: CreateTalentGroupManagerAssignmentCommand,
  ): Promise<TalentGroupManagerAssignment> {
    const now = this.clock();
    const assignment: TalentGroupManagerAssignment = {
      id: crypto.randomUUID(),
      groupId: requireText(command.groupId, "groupId"),
      managerEmploymentProfileId: requireText(
        command.managerEmploymentProfileId,
        "managerEmploymentProfileId",
      ),
      role: normalizeRole(command.role),
      effectiveFrom: normalizeTimestamp(
        command.effectiveFrom,
        "effectiveFrom",
      ),
      effectiveTo:
        command.effectiveTo === undefined || command.effectiveTo === null
          ? null
          : normalizeTimestamp(command.effectiveTo, "effectiveTo"),
      status: normalizeStatus(command.status ?? "ACTIVE"),
      isPrimary: command.isPrimary === true,
      createdAt: now,
      createdByActorId: actor.id,
      updatedAt: now,
      updatedByActorId: actor.id,
    };

    if (
      assignment.effectiveTo !== null &&
      assignment.effectiveTo < assignment.effectiveFrom
    ) {
      throw new KpiValidationError(
        "Talent group manager assignment effectiveTo must be after effectiveFrom",
      );
    }

    return this.repository.insertAssignment(assignment);
  }

  listActiveByGroup(
    groupId: string,
    asOf: number,
  ): Promise<readonly TalentGroupManagerAssignment[]> {
    return this.repository.listActiveAssignmentsByGroup(
      requireText(groupId, "groupId"),
      normalizeTimestamp(asOf, "asOf"),
    );
  }

  listActiveByManagerEmploymentProfile(
    managerEmploymentProfileId: string,
    asOf: number,
  ): Promise<readonly TalentGroupManagerAssignment[]> {
    return this.repository.listActiveAssignmentsByManagerEmploymentProfile(
      requireText(
        managerEmploymentProfileId,
        "managerEmploymentProfileId",
      ),
      normalizeTimestamp(asOf, "asOf"),
    );
  }
}

function normalizeRole(value: unknown): TalentGroupManagerRole {
  const text = requireText(value, "role");
  if (!TALENT_GROUP_MANAGER_ROLES.includes(text as TalentGroupManagerRole)) {
    throw new KpiValidationError(
      `Talent group manager assignment role is unsupported: ${text}`,
    );
  }
  return text as TalentGroupManagerRole;
}

function normalizeStatus(
  value: unknown,
): TalentGroupManagerAssignmentStatus {
  const text = requireText(value, "status");
  if (
    !TALENT_GROUP_MANAGER_ASSIGNMENT_STATUSES.includes(
      text as TalentGroupManagerAssignmentStatus,
    )
  ) {
    throw new KpiValidationError(
      `Talent group manager assignment status is unsupported: ${text}`,
    );
  }
  return text as TalentGroupManagerAssignmentStatus;
}

function normalizeTimestamp(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value)
  ) {
    throw new KpiValidationError(`${field} must be a UTC millisecond timestamp`);
  }
  return value;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new KpiValidationError(`${field} is required`);
  }
  return value.trim();
}
