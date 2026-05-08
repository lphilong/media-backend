import { ClientSession } from "mongodb";
import {
  RoleDelegationBand,
  RoleMaxDelegatableBand,
  RoleRecord,
  RoleState,
} from "./role.types";

export interface UpdateRoleMetadataInput {
  readonly roleId: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly delegationBand?: RoleDelegationBand;
  readonly maxDelegatableBand?: RoleMaxDelegatableBand;
  readonly updatedAt: number;
}

export interface TransitionRoleStateInput {
  readonly roleId: string;
  readonly fromStates: readonly RoleState[];
  readonly toState: RoleState;
  readonly changedAt: number;
}

export interface ReplaceRolePermissionsInput {
  readonly roleId: string;
  readonly permissions: readonly string[];
  readonly updatedAt: number;
}

export interface RoleRepository {
  insert(
    role: RoleRecord,
    session: ClientSession,
  ): Promise<RoleRecord>;

  findById(
    roleId: string,
    session?: ClientSession,
  ): Promise<RoleRecord | null>;

  findByCode(
    code: string,
    session?: ClientSession,
  ): Promise<RoleRecord | null>;

  updateMetadata(
    /**
     * Metadata update contract is intentionally touch-capable.
     * Callers may pass only `{ roleId, updatedAt }` to deterministically
     * refresh the aggregate timestamp without changing name/description.
     */
    input: UpdateRoleMetadataInput,
    session: ClientSession,
  ): Promise<RoleRecord | null>;

  transitionState(
    input: TransitionRoleStateInput,
    session: ClientSession,
  ): Promise<RoleRecord | null>;

  replacePermissions(
    input: ReplaceRolePermissionsInput,
    session: ClientSession,
  ): Promise<RoleRecord | null>;
}
