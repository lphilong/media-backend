import { ClientSession } from "mongodb";

export interface ResponsibilityManagedOrgUnitScope {
  readonly orgUnitId: string;
  readonly role: string | null;
  readonly includeDescendants: boolean;
  readonly actionMask: readonly string[];
  readonly isPrimary: boolean;
}

export interface ResponsibilityManagedTalentGroupScope {
  readonly talentGroupId: string;
  readonly role: string | null;
  readonly actionMask: readonly string[];
  readonly isPrimary: boolean;
}

export interface ResponsibilityManagedScope {
  readonly talentGroupIds: readonly string[];
  /**
   * Exact TalentGroup responsibility evidence. Optional only for bounded
   * compatibility with older readers; approval paths must fail closed when it
   * is absent.
   */
  readonly talentGroupScopes?: readonly ResponsibilityManagedTalentGroupScope[];
  readonly orgUnitIds: readonly string[];
  readonly orgUnitScopes: readonly ResponsibilityManagedOrgUnitScope[];
}

export interface ResponsibilityManagedScopeReader {
  resolveManagedScopeByResponsibleEmploymentProfile(
    input: {
      readonly responsibleEmploymentProfileId: string;
      readonly asOf: number;
    },
    session?: ClientSession,
  ): Promise<ResponsibilityManagedScope>;
}
