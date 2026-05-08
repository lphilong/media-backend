import { Permission } from "@core/permission/permission.enum";
import { PermissionContract } from "./permission.contract";
import { resolvePermissionContract } from "./permission.map";

export class PermissionResolver {
  static resolve(permission: Permission): PermissionContract {
    return resolvePermissionContract(permission);
  }
}
