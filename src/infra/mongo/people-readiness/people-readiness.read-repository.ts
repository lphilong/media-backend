import { Db } from "mongodb";
import { PeopleReadinessReadRepository } from "@modules/people-readiness/read/people-readiness.read-repository";
import { normalizeAccountContexts } from "@modules/account-context/domain/account-context.types";
import {
  PeopleReadinessEmploymentProfile,
  PeopleReadinessOrgUnit,
  PeopleReadinessResponsibilityAssignment,
  PeopleReadinessSnapshot,
  PeopleReadinessTalent,
  PeopleReadinessTalentGroup,
  PeopleReadinessTalentGroupMember,
  PeopleReadinessUser,
} from "@modules/people-readiness/domain/people-readiness.types";

export class NativeMongoPeopleReadinessReadRepository
  implements PeopleReadinessReadRepository
{
  constructor(private readonly db: Db) {}

  async getSnapshot(): Promise<PeopleReadinessSnapshot> {
    const [
      userDocs,
      employmentProfileDocs,
      talentDocs,
      orgUnitDocs,
      talentGroupDocs,
      talentGroupMemberDocs,
      orgUnitResponsibilityDocs,
      talentGroupResponsibilityDocs,
    ] = await Promise.all([
      this.db.collection("users").find({}, {
        projection: { _id: 1, accountStatus: 1, actorKind: 1, accountContexts: 1, "profile.displayName": 1 },
      }).sort({ _id: 1 }).toArray(),
      this.db.collection("employment_profiles").find({}, {
        projection: {
          _id: 1, employeeCode: 1, displayName: 1, orgUnitId: 1,
          linkedUserId: 1, employmentStatus: 1,
        },
      }).sort({ _id: 1 }).toArray(),
      this.db.collection("talents").find({}, {
        projection: {
          _id: 1, talentCode: 1, stageName: 1, displayShortName: 1,
          talentOrigin: 1, operationalStatus: 1, linkedEmploymentProfileId: 1,
        },
      }).sort({ _id: 1 }).toArray(),
      this.db.collection("org_units").find({}, {
        projection: { _id: 1, code: 1, name: 1, type: 1, status: 1 },
      }).sort({ _id: 1 }).toArray(),
      this.db.collection("talent_groups").find({}, {
        projection: { _id: 1, groupCode: 1, name: 1, status: 1 },
      }).sort({ _id: 1 }).toArray(),
      this.db.collection("talent_group_members").find({}, {
        projection: { _id: 1, groupId: 1, talentId: 1, membershipStatus: 1 },
      }).sort({ _id: 1 }).toArray(),
      this.db.collection("responsibility_assignments").find({
        subjectType: "ORG_UNIT",
        responsibilityType: "ORG_UNIT_MANAGER",
      }, {
        projection: {
          _id: 1, subjectId: 1, responsibleEmploymentProfileId: 1,
          responsibilityRole: 1, status: 1, effectiveAt: 1, expiresAt: 1,
        },
      }).sort({ _id: 1 }).toArray(),
      this.db.collection("responsibility_assignments").find({
        subjectType: "TALENT_GROUP",
        responsibilityType: "TALENT_GROUP_MANAGER",
      }, {
        projection: {
          _id: 1, subjectId: 1, responsibleEmploymentProfileId: 1,
          responsibilityRole: 1, status: 1, effectiveAt: 1, expiresAt: 1,
        },
      }).sort({ _id: 1 }).toArray(),
    ]);

    return {
      users: userDocs.map((doc) => ({
        id: String(doc._id),
        displayName: readText(doc.profile, "displayName") ?? String(doc._id),
        accountStatus: String(doc.accountStatus ?? "UNKNOWN"),
        actorKind: String(doc.actorKind ?? "UNKNOWN"),
        accountContexts: normalizeAccountContexts(doc.accountContexts),
      } satisfies PeopleReadinessUser)),
      employmentProfiles: employmentProfileDocs.map((doc) => ({
        id: String(doc._id),
        employeeCode: String(doc.employeeCode ?? doc._id),
        displayName: String(doc.displayName ?? doc.employeeCode ?? doc._id),
        orgUnitId: nullableString(doc.orgUnitId),
        linkedUserId: nullableString(doc.linkedUserId),
        employmentStatus: String(doc.employmentStatus ?? "UNKNOWN"),
      } satisfies PeopleReadinessEmploymentProfile)),
      talents: talentDocs.map((doc) => ({
        id: String(doc._id),
        talentCode: String(doc.talentCode ?? doc._id),
        displayName: String(doc.displayShortName ?? doc.stageName ?? doc.talentCode ?? doc._id),
        talentOrigin: String(doc.talentOrigin ?? "UNKNOWN"),
        operationalStatus: String(doc.operationalStatus ?? "UNKNOWN"),
        linkedEmploymentProfileId: nullableString(doc.linkedEmploymentProfileId),
      } satisfies PeopleReadinessTalent)),
      orgUnits: orgUnitDocs.map((doc) => ({
        id: String(doc._id),
        code: String(doc.code ?? doc._id),
        name: String(doc.name ?? doc.code ?? doc._id),
        type: String(doc.type ?? "UNKNOWN"),
        status: String(doc.status ?? "UNKNOWN"),
      } satisfies PeopleReadinessOrgUnit)),
      talentGroups: talentGroupDocs.map((doc) => ({
        id: String(doc._id),
        groupCode: String(doc.groupCode ?? doc._id),
        name: String(doc.name ?? doc.groupCode ?? doc._id),
        status: String(doc.status ?? "UNKNOWN"),
      } satisfies PeopleReadinessTalentGroup)),
      talentGroupMembers: talentGroupMemberDocs.map((doc) => ({
        id: String(doc._id),
        groupId: String(doc.groupId ?? ""),
        talentId: String(doc.talentId ?? ""),
        membershipStatus: String(doc.membershipStatus ?? "UNKNOWN"),
      } satisfies PeopleReadinessTalentGroupMember)),
      orgUnitResponsibilities: orgUnitResponsibilityDocs.map((doc) =>
        toResponsibilityAssignment(doc),
      ),
      talentGroupResponsibilities: talentGroupResponsibilityDocs.map((doc) =>
        toResponsibilityAssignment(doc),
      ),
    };
  }
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readText(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const text = (value as Record<string, unknown>)[key];
  return typeof text === "string" && text.length > 0 ? text : undefined;
}

function toResponsibilityAssignment(
  doc: Record<string, unknown>,
): PeopleReadinessResponsibilityAssignment {
  return {
    id: String(doc._id),
    targetId: String(doc.subjectId ?? ""),
    responsibleEmploymentProfileId:
      String(doc.responsibleEmploymentProfileId ?? ""),
    responsibilityRole: String(doc.responsibilityRole ?? "MANAGER"),
    status: String(doc.status ?? "UNKNOWN"),
    effectiveAt: Number(doc.effectiveAt ?? 0),
    expiresAt: typeof doc.expiresAt === "number" ? doc.expiresAt : null,
  };
}
