import { ClientSession } from "mongodb";
import { RoleAssignmentRuleRecord } from "./role.types";

export interface ReplaceRoleAssignmentRulesInput {
  readonly roleId: string;
  readonly rules: readonly RoleAssignmentRuleRecord[];
}

export interface RoleAssignmentRuleRepository {
  /**
   * Authoritative replace-all contract for one role.
   * Implementations must discard prior persisted rules for `roleId`
   * and persist only `input.rules` from the command payload.
   */
  replaceForRole(
    input: ReplaceRoleAssignmentRulesInput,
    session: ClientSession,
  ): Promise<readonly RoleAssignmentRuleRecord[]>;

  listByRoleId(
    roleId: string,
    session?: ClientSession,
  ): Promise<readonly RoleAssignmentRuleRecord[]>;
}
