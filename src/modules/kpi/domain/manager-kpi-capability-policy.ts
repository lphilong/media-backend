import { Permission } from "@core/permission/permission.enum";

export const MANAGER_KPI_CAPABILITY_PERMISSIONS = Object.freeze([
  Permission.KPI_READ,
  Permission.KPI_READ_PROGRESS,
  Permission.KPI_MANAGE_ALLOCATION,
  Permission.KPI_ENTER_ACTUAL,
  Permission.KPI_CORRECT_ACTUAL,
  Permission.KPI_APPROVE_ALLOCATION,
] as const);

export interface ManagerKpiCapabilities {
  readonly read: boolean;
  readonly readProgress: boolean;
  readonly manageAllocation: boolean;
  readonly enterActual: boolean;
  readonly correctActual: boolean;
  readonly approveAllocation: boolean;
  readonly finalize: false;
}

export function projectManagerKpiCapabilities(
  grantedPermissions: ReadonlySet<Permission>,
): ManagerKpiCapabilities {
  return Object.freeze({
    read: grantedPermissions.has(Permission.KPI_READ),
    readProgress: grantedPermissions.has(Permission.KPI_READ_PROGRESS),
    manageAllocation: grantedPermissions.has(Permission.KPI_MANAGE_ALLOCATION),
    enterActual: grantedPermissions.has(Permission.KPI_ENTER_ACTUAL),
    correctActual: grantedPermissions.has(Permission.KPI_CORRECT_ACTUAL),
    approveAllocation: grantedPermissions.has(Permission.KPI_APPROVE_ALLOCATION),
    finalize: false,
  });
}
