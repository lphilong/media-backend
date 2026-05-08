import { PermissionContract } from "../permission/permission.contract";

/**
 * AuditContract is derived from PermissionContract.
 * Snapshot only – no enum, no validation here.
 */
export interface AuditContract {
  readonly action: string;
  readonly resource: string;
}

/**
 * Derive audit intent from permission contract.
 * Fail-closed by PermissionResolver, not here.
 */
export function deriveAuditContract(
  permission: PermissionContract,
): AuditContract {
  return {
    action: permission.auditAction,
    resource: permission.resource,
  };
}
