import { ClientSession } from "mongodb";
import {
  OrgUnitRecord,
  OrgUnitStatus,
} from "./org-unit.types";

export interface FindLiveSiblingByNormalizedNameInput {
  readonly parentOrgUnitId: string | null;
  readonly normalizedName: string;
  readonly excludeOrgUnitId?: string;
}

export interface UpdateOrgUnitProfileInput {
  readonly orgUnitId: string;
  readonly name?: string;
  readonly normalizedName?: string;
  readonly description?: string | null;
  readonly displayOrder?: number;
  readonly externalRef?: string | null;
  readonly updatedAt: number;
}

export interface RewriteOrgUnitHierarchyDescendantInput {
  readonly orgUnitId: string;
  readonly ancestorChain: readonly string[];
  readonly depth: number;
  readonly updatedAt: number;
}

export interface RewriteOrgUnitHierarchyInput {
  readonly orgUnitId: string;
  readonly parentOrgUnitId: string | null;
  readonly ancestorChain: readonly string[];
  readonly depth: number;
  readonly updatedAt: number;
  readonly descendants: readonly RewriteOrgUnitHierarchyDescendantInput[];
}

export interface TransitionOrgUnitStatusInput {
  readonly orgUnitId: string;
  readonly fromStatuses: readonly OrgUnitStatus[];
  readonly toStatus: OrgUnitStatus;
  readonly updatedAt: number;
}

export interface OrgUnitRepository {
  insert(
    orgUnit: OrgUnitRecord,
    session: ClientSession,
  ): Promise<OrgUnitRecord>;

  findById(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<OrgUnitRecord | null>;

  findByCode(
    code: string,
    session?: ClientSession,
  ): Promise<OrgUnitRecord | null>;

  findLiveSiblingByNormalizedName(
    input: FindLiveSiblingByNormalizedNameInput,
    session?: ClientSession,
  ): Promise<OrgUnitRecord | null>;

  updateProfile(
    input: UpdateOrgUnitProfileInput,
    session: ClientSession,
  ): Promise<OrgUnitRecord | null>;

  rewriteHierarchy(
    input: RewriteOrgUnitHierarchyInput,
    session: ClientSession,
  ): Promise<OrgUnitRecord | null>;

  transitionStatus(
    input: TransitionOrgUnitStatusInput,
    session: ClientSession,
  ): Promise<OrgUnitRecord | null>;

  listDescendants(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<readonly OrgUnitRecord[]>;

  hasDescendantWithStatuses(
    orgUnitId: string,
    statuses: readonly OrgUnitStatus[],
    session?: ClientSession,
  ): Promise<boolean>;

  hasNonArchivedDescendants(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<boolean>;
}
