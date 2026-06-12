import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { EmploymentProfileRepository } from "@modules/employment-profile/domain/employment-profile.repository";
import { EventAssignmentPermissionScopeError } from "@modules/event-assignment/domain/event-assignment.errors";
import { ManagerEventSummaryView } from "@modules/event-assignment/domain/event-assignment.types";
import { EventAssignmentReadRepository } from "@modules/event-assignment/read/event-assignment.read-repository";
import { OrgUnitManagerAssignmentRepository } from "@modules/kpi/domain/org-unit-manager-assignment.repository";
import { TalentGroupManagerAssignmentRepository } from "@modules/kpi/domain/talent-group-manager-assignment.repository";

export class ManagerWorkspaceEventAdminService {
  constructor(
    private readonly employmentProfileRepository: Pick<
      EmploymentProfileRepository,
      "findNonArchivedByLinkedUserId"
    >,
    private readonly talentGroupManagerAssignmentRepository: Pick<
      TalentGroupManagerAssignmentRepository,
      "listActiveAssignmentsByManagerEmploymentProfile"
    >,
    private readonly orgUnitManagerAssignmentRepository: Pick<
      OrgUnitManagerAssignmentRepository,
      "listActiveByManagerEmploymentProfileId"
    >,
    private readonly readRepository: Pick<
      EventAssignmentReadRepository,
      "listManagerEventSummaries" | "getManagerEventSummary"
    >,
    private readonly clock: () => number = Date.now,
  ) {}

  async listEvents(actor: Actor): Promise<{
    readonly items: readonly ManagerEventSummaryView[];
  }> {
    const scope = await this.resolveScope(actor);
    return {
      items: await this.readRepository.listManagerEventSummaries(scope),
    };
  }

  async getEvent(
    actor: Actor,
    eventId: string,
  ): Promise<ManagerEventSummaryView> {
    const normalizedEventId = eventId.trim();
    if (!normalizedEventId) {
      throw new EventAssignmentPermissionScopeError("eventId is required");
    }
    const scope = await this.resolveScope(actor);
    const event = await this.readRepository.getManagerEventSummary({
      eventId: normalizedEventId,
      ...scope,
    });
    if (!event) {
      throw new EventAssignmentPermissionScopeError(
        "Event is outside the actor's active manager assignment scope",
      );
    }
    return event;
  }

  private async resolveScope(actor: Actor): Promise<{
    readonly orgUnitIds: readonly string[];
    readonly talentGroupIds: readonly string[];
  }> {
    if (actor.type !== "admin") {
      throw new EventAssignmentPermissionScopeError(
        "Manager Workspace Events requires ADMIN context actor",
      );
    }
    PermissionGuard.assert(
      actor,
      PermissionResolver.resolve(Permission.EVENT_READ),
    );
    const profile =
      await this.employmentProfileRepository.findNonArchivedByLinkedUserId(
        actor.id,
      );
    if (!profile || profile.employmentStatus !== "ACTIVE") {
      throw new EventAssignmentPermissionScopeError(
        "Active linked EmploymentProfile is required",
      );
    }
    const asOf = this.clock();
    const [orgUnits, talentGroups] = await Promise.all([
      this.orgUnitManagerAssignmentRepository.listActiveByManagerEmploymentProfileId(
        profile.id,
        asOf,
      ),
      this.talentGroupManagerAssignmentRepository.listActiveAssignmentsByManagerEmploymentProfile(
        profile.id,
        asOf,
      ),
    ]);
    return {
      orgUnitIds: [...new Set(orgUnits.map((item) => item.orgUnitId))].sort(),
      talentGroupIds: [
        ...new Set(talentGroups.map((item) => item.groupId)),
      ].sort(),
    };
  }
}
