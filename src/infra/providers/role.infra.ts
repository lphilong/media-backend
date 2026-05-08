import { Db } from "mongodb";
import {
  NativeMongoRoleReadRepository,
  NativeMongoRoleAssignmentReadRepository,
  NativeMongoRoleUserReadonlyAccess,
} from "@infra/mongo/role/role.read-repository";
import {
  NativeMongoRoleAssignmentRuleRepository,
  NativeMongoRoleRepository,
  NativeMongoUserRoleAssignmentRepository,
} from "@infra/mongo/role/role.repository";

export interface RoleInfra {
  readonly roleRepository: NativeMongoRoleRepository;
  readonly userRoleAssignmentRepository: NativeMongoUserRoleAssignmentRepository;
  readonly roleAssignmentRuleRepository: NativeMongoRoleAssignmentRuleRepository;
  readonly roleReadonlyAccess: NativeMongoRoleUserReadonlyAccess;
  readonly roleReadRepository: NativeMongoRoleReadRepository;
  readonly roleAssignmentReadRepository: NativeMongoRoleAssignmentReadRepository;
}

export function createRoleInfra(db: Db): RoleInfra {
  return {
    roleRepository: new NativeMongoRoleRepository(db),
    userRoleAssignmentRepository:
      new NativeMongoUserRoleAssignmentRepository(db),
    roleAssignmentRuleRepository:
      new NativeMongoRoleAssignmentRuleRepository(db),
    roleReadonlyAccess:
      new NativeMongoRoleUserReadonlyAccess(db),
    roleReadRepository: new NativeMongoRoleReadRepository(
      db,
    ),
    roleAssignmentReadRepository:
      new NativeMongoRoleAssignmentReadRepository(db),
  };
}
