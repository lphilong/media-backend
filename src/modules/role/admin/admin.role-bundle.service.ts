import { listRoleBundles, RoleBundleTemplate } from "@modules/role/domain/role-bundle.catalog";

export class RoleBundleAdminService {
  listBundles(): readonly RoleBundleTemplate[] {
    return listRoleBundles();
  }
}
