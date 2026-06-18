import crypto from "crypto";
import { Actor } from "@core/actor/actor";
import { RoleAssignmentConflictError, RoleDependencyError, RoleValidationError } from "@modules/role/domain/role.errors";
import { getRoleBundle, listRoleBundles, RoleBundleTemplate } from "@modules/role/domain/role-bundle.catalog";
import { RoleRepository } from "@modules/role/domain/role.repository";
import { RoleAssignmentScopeGrant } from "@modules/role/domain/role-assignment-scope";
import { RoleRecord } from "@modules/role/domain/role.types";
import { RoleAdminService } from "./admin.role.service";

export interface AssignRoleBundleCommand {
  readonly bundleCode: string;
  readonly bundleVersion: string;
  readonly userId: string;
  readonly reason?: string | null;
  readonly structuredScopeGrants?: readonly RoleAssignmentScopeGrant[];
  readonly expiresAt?: number | string | null;
  readonly reviewAt?: number | string | null;
}

export interface RoleBundleAssignmentResult {
  readonly bundleAssignmentId: string;
  readonly bundleCode: string;
  readonly bundleVersion: string;
  readonly userId: string;
  readonly reason: string;
  readonly childAssignments: readonly {
    readonly roleId: string;
    readonly roleCode: string;
    readonly status: "CREATED" | "EXISTING";
    readonly assignmentId: string | null;
  }[];
  readonly createdAt: number;
}

export class RoleBundleAdminService {
  constructor(
    private readonly roleRepository: RoleRepository,
    private readonly roleService: RoleAdminService,
    private readonly bundleLookup: (
      code: string,
      version?: string,
    ) => RoleBundleTemplate | null = getRoleBundle,
  ) {}

  listBundles(): readonly RoleBundleTemplate[] {
    return listRoleBundles();
  }

  async assignBundle(
    actor: Actor,
    command: AssignRoleBundleCommand,
  ): Promise<RoleBundleAssignmentResult> {
    const bundle = this.bundleLookup(
      command.bundleCode,
      command.bundleVersion,
    );
    if (!bundle || bundle.status !== "ACTIVE") {
      throw new RoleValidationError("Unknown or inactive role bundle/version");
    }
    const reason = normalizeReason(command.reason);
    const userId = normalizeRequired(command.userId, "userId");
    const bundleAssignmentId = crypto.randomUUID();
    const childAssignments: RoleBundleAssignmentResult["childAssignments"][number][] = [];
    const childRoles: RoleRecord[] = [];

    for (const roleCode of bundle.childRoles) {
      const role = await this.roleRepository.findByCode(roleCode);
      if (!role || role.state !== "ACTIVE") {
        throw new RoleDependencyError(
          `Bundle child role must exist and be ACTIVE: ${roleCode}`,
        );
      }
      childRoles.push(role);
    }

    for (const role of childRoles) {
      try {
        const assignment = await this.roleService.assignRoleToUser(actor, {
          roleId: role.id,
          userId,
          reason,
          structuredScopeGrants: command.structuredScopeGrants,
          expiresAt: command.expiresAt,
          reviewAt: command.reviewAt,
          bundleOrigin: {
            bundleAssignmentId,
            bundleCode: bundle.code,
            bundleVersion: bundle.version,
          },
        });
        childAssignments.push({
          roleId: role.id,
          roleCode: role.code,
          status: "CREATED",
          assignmentId: assignment.assignmentId,
        });
      } catch (error) {
        if (!(error instanceof RoleAssignmentConflictError)) {
          throw error;
        }
        childAssignments.push({
          roleId: role.id,
          roleCode: role.code,
          status: "EXISTING",
          assignmentId: null,
        });
      }
    }

    return {
      bundleAssignmentId,
      bundleCode: bundle.code,
      bundleVersion: bundle.version,
      userId,
      reason,
      childAssignments,
      createdAt: Date.now(),
    };
  }
}

function normalizeRequired(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new RoleValidationError(`${field} is required`);
  }
  return value.trim();
}

function normalizeReason(value: unknown): string {
  const reason = normalizeRequired(value, "reason");
  return reason;
}
