import { Permission } from "@core/permission/permission.enum";
import {
  PermissionContract,
  PermissionContracts,
} from "./permission.contract";
import { SystemInvariantError } from "@core/error/system-error";

/**
 * Resolve Permission enum to PermissionContract.
 * Single source of truth.
 */
export function resolvePermissionContract(
  permission: Permission,
): PermissionContract {
  const contract = PermissionContracts[permission];

  if (!contract) {
    throw new SystemInvariantError(
      "PERMISSION_CONTRACT_MISSING",
      `Permission ${permission} is not declared in PermissionContracts`,
    );
  }

  return contract;
}
