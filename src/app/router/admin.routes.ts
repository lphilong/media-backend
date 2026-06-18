import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { InfraModule } from "@infra/infra.module";
import { createUserInfra } from "@infra/providers/user.infra";
import { createRoleInfra } from "@infra/providers/role.infra";
import { createOrgUnitInfra } from "@infra/providers/org-unit.infra";
import { createEmploymentProfileInfra } from "@infra/providers/employment-profile.infra";
import { createEmploymentTermsInfra } from "@infra/providers/employment-terms.infra";
import { createTalentInfra } from "@infra/providers/talent.infra";
import { createTalentGroupInfra } from "@infra/providers/talent-group.infra";
import { createPlatformAccountInfra } from "@infra/providers/platform-account.infra";
import { createStudioResourceInfra } from "@infra/providers/studio-resource.infra";
import { createWorkScheduleInfra } from "@infra/providers/work-schedule.infra";
import { createEventAssignmentInfra } from "@infra/providers/event-assignment.infra";
import { createContractRegistryInfra } from "@infra/providers/contract-registry.infra";
import { createTalentKpiInfra } from "@infra/providers/talent-kpi.infra";
import { createKpiInfra } from "@infra/providers/kpi.infra";
import { createCommissionRevenueShareInfra } from "@infra/providers/commission.infra";
import { createRevenueLedgerInfra } from "@infra/providers/revenue-ledger.infra";
import { createDashboardLiteInfra } from "@infra/providers/dashboard-lite.infra";
import { createPeopleReadinessInfra } from "@infra/providers/people-readiness.infra";
import { NativeMongoReferenceLookupReadRepository } from "@infra/mongo/reference-lookup/reference-lookup.read-repository";
import { auditScopeMiddleware } from "@core/audit/audit.scope.middleware";
import { MongoAuthoritativeAdminMutationBridge } from "@core/application/mongo-authoritative-admin-mutation.bridge";
import { AuditGuard } from "@core/audit/audit.guard";
import { MongoAuditLogger } from "@core/audit/mongo.audit.logger";
import { MongoAuditWriteRepository } from "@infra/mongo/audit/audit.write.repository";
import { AuditContext } from "@core/audit/audit.context";
import { ActorSnapshotCacheInvalidator } from "@infra/cache/actor.snapshot.cache";
import {
  Auth0ManagementHttpClient,
  DisabledAuth0ManagementClient,
  resolveAuth0ManagementConfigFromEnv,
} from "@infra/auth0/auth0-management.client";
import { CurrentActorCapabilitiesController } from "./current-actor-capabilities.controller";
import { adminReferenceLookupRoutes } from "@modules/reference-lookup/admin/admin.reference-lookup.routes";
import { ReferenceLookupAdminController } from "@modules/reference-lookup/admin/admin.reference-lookup.controller";
import { ReferenceLookupAdminService } from "@modules/reference-lookup/admin/admin.reference-lookup.service";

/* USER */
import { userAdminRoutes } from "@modules/user/admin/admin.user.routes";
import { UserAdminController } from "@modules/user/admin/admin.user.controller";
import { UserQueryAdminController } from "@modules/user/admin/admin.user.query.controller";
import { UserLifecycleService } from "@modules/user/admin/admin.user.service";
import { UserAdminQueryService } from "@modules/user/admin/admin.user.query-service";

/* ROLE */
import { adminRoleRoutes } from "@modules/role/admin/admin.role.routes";
import { AdminRoleController } from "@modules/role/admin/admin.role.controller";
import { AdminRoleQueryController } from "@modules/role/admin/admin.role.query.controller";
import { RoleAdminService } from "@modules/role/admin/admin.role.service";
import { RoleAdminQueryService } from "@modules/role/admin/admin.role.query-service";
import { adminRoleTemplateRoutes } from "@modules/role/admin/admin.role-template.routes";
import { AdminRoleTemplateController } from "@modules/role/admin/admin.role-template.controller";
import { RoleTemplateAdminService } from "@modules/role/admin/admin.role-template.service";
import { AdminRoleBundleController } from "@modules/role/admin/admin.role-bundle.controller";
import { RoleBundleAdminService } from "@modules/role/admin/admin.role-bundle.service";
import { adminRoleBundleRoutes } from "@modules/role/admin/admin.role-bundle.routes";
import { AdminEffectiveAccessController } from "@modules/role/admin/admin.effective-access.controller";
import { EffectiveAccessAdminService } from "@modules/role/admin/admin.effective-access.service";
import { adminEffectiveAccessRoutes } from "@modules/role/admin/admin.effective-access.routes";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";
import { NativeMongoStructuredScopeAuthorityReader } from "@infra/mongo/role/structured-scope-authority.repository";

/* ORG UNIT */
import { adminOrgUnitRoutes } from "@modules/org-unit/admin/admin.org-unit.routes";
import { OrgUnitAdminController } from "@modules/org-unit/admin/admin.org-unit.controller";
import { OrgUnitAdminQueryController } from "@modules/org-unit/admin/admin.org-unit.query.controller";
import { OrgUnitAdminService } from "@modules/org-unit/admin/admin.org-unit.service";
import { OrgUnitAdminQueryService } from "@modules/org-unit/admin/admin.org-unit.query-service";
import { OrgUnitResponsibilityAdminService } from "@modules/org-unit/admin/admin.org-unit-responsibility.service";
import { OrgUnitResponsibilityAdminController } from "@modules/org-unit/admin/admin.org-unit-responsibility.controller";

/* EMPLOYMENT PROFILE */
import { adminEmploymentProfileRoutes } from "@modules/employment-profile/admin/admin.employment-profile.routes";
import { EmploymentProfileAdminController } from "@modules/employment-profile/admin/admin.employment-profile.controller";
import { EmploymentProfileAdminQueryController } from "@modules/employment-profile/admin/admin.employment-profile.query.controller";
import { EmploymentProfileAdminService } from "@modules/employment-profile/admin/admin.employment-profile.service";
import { EmploymentProfileAdminQueryService } from "@modules/employment-profile/admin/admin.employment-profile.query-service";

/* EMPLOYMENT TERMS */
import {
  adminEmploymentTermsAllProfilesRoutes,
  adminEmploymentTermsRoutes,
} from "@modules/employment-terms/admin/admin.employment-terms.routes";
import { EmploymentTermsAdminController } from "@modules/employment-terms/admin/admin.employment-terms.controller";
import { EmploymentTermsAdminService } from "@modules/employment-terms/admin/admin.employment-terms.service";

/* TALENT */
import { adminTalentRoutes } from "@modules/talent/admin/admin.talent.routes";
import { TalentAdminController } from "@modules/talent/admin/admin.talent.controller";
import { TalentAdminQueryController } from "@modules/talent/admin/admin.talent.query.controller";
import { TalentAdminService } from "@modules/talent/admin/admin.talent.service";
import { TalentAdminQueryService } from "@modules/talent/admin/admin.talent.query-service";

/* TALENT GROUP */
import { TalentGroupAdminService } from "@modules/talent-group/admin/admin.talent-group.service";
import { TalentGroupManagerAssignmentAdminService } from "@modules/talent-group/admin/admin.talent-group-manager-assignment.service";
import { TalentGroupAdminQueryService } from "@modules/talent-group/admin/admin.talent-group.query-service";
import { TalentGroupAdminController } from "@modules/talent-group/admin/admin.talent-group.controller";
import { TalentGroupManagerAssignmentAdminController } from "@modules/talent-group/admin/admin.talent-group-manager-assignment.controller";
import { TalentGroupAdminQueryController } from "@modules/talent-group/admin/admin.talent-group.query.controller";
import { adminTalentGroupRoutes } from "@modules/talent-group/admin/admin.talent-group.routes";

/* PLATFORM ACCOUNT */
import { adminPlatformAccountRoutes } from "@modules/platform-account/admin/admin.platform-account.routes";
import { PlatformAccountAdminController } from "@modules/platform-account/admin/admin.platform-account.controller";
import { PlatformAccountAdminQueryController } from "@modules/platform-account/admin/admin.platform-account.query.controller";
import { PlatformAccountAdminService } from "@modules/platform-account/admin/admin.platform-account.service";
import { PlatformAccountAdminQueryService } from "@modules/platform-account/admin/admin.platform-account.query-service";

/* STUDIO RESOURCE */
import { adminStudioResourceRoutes } from "@modules/studio-resource/admin/admin.studio-resource.routes";
import { StudioResourceAdminController } from "@modules/studio-resource/admin/admin.studio-resource.controller";
import { StudioResourceAdminQueryController } from "@modules/studio-resource/admin/admin.studio-resource.query.controller";
import { StudioResourceAdminService } from "@modules/studio-resource/admin/admin.studio-resource.service";
import { StudioResourceAdminQueryService } from "@modules/studio-resource/admin/admin.studio-resource.query-service";

/* WORK SCHEDULE */
import { adminWorkScheduleRoutes } from "@modules/work-schedule/admin/admin.work-schedule.routes";
import { WorkScheduleAdminController } from "@modules/work-schedule/admin/admin.work-schedule.controller";
import { WorkScheduleAdminQueryController } from "@modules/work-schedule/admin/admin.work-schedule.query.controller";
import { WorkScheduleAdminService } from "@modules/work-schedule/admin/admin.work-schedule.service";
import { WorkScheduleAdminQueryService } from "@modules/work-schedule/admin/admin.work-schedule.query-service";
import { adminWorkScheduleRequestRoutes } from "@modules/work-schedule/admin/admin.work-schedule-request.routes";
import { WorkScheduleRequestAdminController } from "@modules/work-schedule/admin/admin.work-schedule-request.controller";
import { WorkScheduleRequestAdminService } from "@modules/work-schedule/admin/admin.work-schedule-request.service";
import { adminWorkScheduleRequestBatchRoutes } from "@modules/work-schedule/admin/admin.work-schedule-request-batch.routes";
import { WorkScheduleRequestBatchAdminController } from "@modules/work-schedule/admin/admin.work-schedule-request-batch.controller";
import { WorkScheduleRequestBatchAdminService } from "@modules/work-schedule/admin/admin.work-schedule-request-batch.service";
import { adminWorkScheduleAvailabilityBatchRoutes } from "@modules/work-schedule/admin/admin.work-schedule-availability-batch.routes";
import { WorkScheduleAvailabilityBatchAdminController } from "@modules/work-schedule/admin/admin.work-schedule-availability-batch.controller";
import { WorkScheduleAvailabilityBatchAdminService } from "@modules/work-schedule/admin/admin.work-schedule-availability-batch.service";
import { adminWorkPatternRoutes } from "@modules/work-schedule/admin/admin.work-pattern.routes";
import { WorkPatternAdminController } from "@modules/work-schedule/admin/admin.work-pattern.controller";
import { WorkPatternAdminQueryController } from "@modules/work-schedule/admin/admin.work-pattern.query.controller";
import { WorkPatternAdminService } from "@modules/work-schedule/admin/admin.work-pattern.service";
import { WorkPatternAdminQueryService } from "@modules/work-schedule/admin/admin.work-pattern.query-service";
import { adminHolidayCalendarRoutes } from "@modules/work-schedule/admin/admin.holiday-calendar.routes";
import { HolidayCalendarAdminController } from "@modules/work-schedule/admin/admin.holiday-calendar.controller";
import { HolidayCalendarAdminQueryController } from "@modules/work-schedule/admin/admin.holiday-calendar.query.controller";
import { HolidayCalendarAdminService } from "@modules/work-schedule/admin/admin.holiday-calendar.service";
import { HolidayCalendarAdminQueryService } from "@modules/work-schedule/admin/admin.holiday-calendar.query-service";
import { adminMonthlyRosterRoutes } from "@modules/work-schedule/admin/admin.monthly-roster.routes";
import { MonthlyRosterAdminController } from "@modules/work-schedule/admin/admin.monthly-roster.controller";
import { MonthlyRosterAdminQueryController } from "@modules/work-schedule/admin/admin.monthly-roster.query.controller";
import { MonthlyRosterAdminService } from "@modules/work-schedule/admin/admin.monthly-roster.service";
import { MonthlyRosterAdminQueryService } from "@modules/work-schedule/admin/admin.monthly-roster.query-service";

/* EVENT ASSIGNMENT */
import { adminEventAssignmentRoutes } from "@modules/event-assignment/admin/admin.event-assignment.routes";
import { EventAssignmentAdminController } from "@modules/event-assignment/admin/admin.event-assignment.controller";
import { EventAssignmentAdminQueryController } from "@modules/event-assignment/admin/admin.event-assignment.query.controller";
import { EventAssignmentAdminService } from "@modules/event-assignment/admin/admin.event-assignment.service";
import { EventAssignmentAdminQueryService } from "@modules/event-assignment/admin/admin.event-assignment.query-service";

/* CONTRACT REGISTRY */
import { adminContractRegistryRoutes } from "@modules/contract-registry/admin/admin.contract-registry.routes";
import { ContractRegistryAdminController } from "@modules/contract-registry/admin/admin.contract-registry.controller";
import { ContractRegistryAdminQueryController } from "@modules/contract-registry/admin/admin.contract-registry.query.controller";
import { ContractRegistryAdminService } from "@modules/contract-registry/admin/admin.contract-registry.service";
import { ContractRegistryAdminQueryService } from "@modules/contract-registry/admin/admin.contract-registry.query-service";
import { ContractObligationAdminController } from "@modules/contract-registry/admin/admin.contract-obligation.controller";
import { ContractObligationAdminService } from "@modules/contract-registry/admin/admin.contract-obligation.service";
import { ContractObligationAdminQueryService } from "@modules/contract-registry/admin/admin.contract-obligation.query-service";
import { ContractObligationEventEvidenceLinkAdminController } from "@modules/contract-registry/admin/admin.contract-obligation-event-evidence-link.controller";
import { ContractObligationEventEvidenceLinkAdminQueryService } from "@modules/contract-registry/admin/admin.contract-obligation-event-evidence-link.query-service";
import { ContractObligationEventEvidenceLinkAdminService } from "@modules/contract-registry/admin/admin.contract-obligation-event-evidence-link.service";

/* TALENT KPI */
import { adminTalentKpiRoutes } from "@modules/talent-kpi/admin/admin.talent-kpi.routes";
import { TalentKpiAdminController } from "@modules/talent-kpi/admin/admin.talent-kpi.controller";
import { TalentKpiAdminQueryController } from "@modules/talent-kpi/admin/admin.talent-kpi.query.controller";
import { TalentKpiAdminService } from "@modules/talent-kpi/admin/admin.talent-kpi.service";
import { TalentKpiAdminQueryService } from "@modules/talent-kpi/admin/admin.talent-kpi.query-service";

/* KPI V2 */
import { adminKpiRoutes } from "@modules/kpi/admin/admin.kpi.routes";
import { KpiAdminController } from "@modules/kpi/admin/admin.kpi.controller";
import { KpiAdminQueryController } from "@modules/kpi/admin/admin.kpi.query.controller";
import { KpiAdminService } from "@modules/kpi/admin/admin.kpi.service";
import { adminManagerWorkspaceRoutes } from "@modules/manager-workspace/admin/admin.manager-workspace.routes";
import { ManagerWorkspaceAdminController } from "@modules/manager-workspace/admin/admin.manager-workspace.controller";
import { ManagerWorkspaceAdminService } from "@modules/manager-workspace/admin/admin.manager-workspace.service";
import { ManagerWorkspaceWorkScheduleAdminService } from "@modules/manager-workspace/admin/admin.manager-workspace-work-schedule.service";
import { ManagerWorkspaceEventAdminService } from "@modules/manager-workspace/admin/admin.manager-workspace-event.service";
import { ManagerWorkspaceRevenueAdminService } from "@modules/manager-workspace/admin/admin.manager-workspace-revenue.service";

/* COMMISSION */
import { adminCommissionRoutes } from "@modules/commission/admin/admin.commission.routes";
import { CommissionAdminController } from "@modules/commission/admin/admin.commission.controller";
import { CommissionAdminQueryController } from "@modules/commission/admin/admin.commission.query.controller";
import { CommissionAdminService } from "@modules/commission/admin/admin.commission.service";
import { CommissionAdminQueryService } from "@modules/commission/admin/admin.commission.query-service";

/* REVENUE LEDGER */
import { adminRevenueLedgerRoutes } from "@modules/revenue-ledger/admin/admin.revenue-ledger.routes";
import { adminPlatformEarningRoutes } from "@modules/revenue-ledger/admin/admin.platform-earning.routes";
import { PlatformEarningAdminController } from "@modules/revenue-ledger/admin/admin.platform-earning.controller";
import { PlatformEarningAdminService } from "@modules/revenue-ledger/admin/admin.platform-earning.service";
import { RevenueLedgerAdminController } from "@modules/revenue-ledger/admin/admin.revenue-ledger.controller";
import { RevenueLedgerAdminQueryController } from "@modules/revenue-ledger/admin/admin.revenue-ledger.query.controller";
import { RevenueLedgerAdminService } from "@modules/revenue-ledger/admin/admin.revenue-ledger.service";
import { RevenueLedgerAdminQueryService } from "@modules/revenue-ledger/admin/admin.revenue-ledger.query-service";

/* DASHBOARD LITE */
import { adminDashboardLiteRoutes } from "@modules/dashboard-lite/admin/admin.dashboard-lite.routes";
import { DashboardLiteAdminQueryController } from "@modules/dashboard-lite/admin/admin.dashboard-lite.query.controller";
import { DashboardLiteAdminQueryService } from "@modules/dashboard-lite/admin/admin.dashboard-lite.query-service";
import { adminPeopleReadinessRoutes } from "@modules/people-readiness/admin/admin.people-readiness.routes";
import { PeopleReadinessAdminController } from "@modules/people-readiness/admin/admin.people-readiness.controller";
import { PeopleReadinessAdminService } from "@modules/people-readiness/admin/admin.people-readiness.service";

export async function createAdminRoutes(infra: InfraModule): Promise<Router> {
  const r = Router();
  r.use(auditScopeMiddleware);

  const currentActorCapabilitiesController =
    new CurrentActorCapabilitiesController();

  r.get(
    "/me/capabilities",
    withCommand("CURRENT_ACTOR_CAPABILITIES"),
    currentActorCapabilitiesController.execute,
  );

  const referenceLookupController = new ReferenceLookupAdminController(
    new ReferenceLookupAdminService(
      new NativeMongoReferenceLookupReadRepository(infra.primaryDb),
    ),
  );

  r.use("/reference", adminReferenceLookupRoutes(referenceLookupController));

  const adminMutationBridge = new MongoAuthoritativeAdminMutationBridge(
    infra.mongoClient,
    infra.primaryDb,
  );

  const authoritativeAuditGuard = new AuditGuard(
    new MongoAuditLogger(new MongoAuditWriteRepository(infra.primaryDb)),
    new AuditContext(),
  );

  const actorSnapshotCacheInvalidator = new ActorSnapshotCacheInvalidator(
    infra.cacheAdapter,
  );

  const auth0ManagementConfig = resolveAuth0ManagementConfigFromEnv();
  const auth0ManagementClient = auth0ManagementConfig
    ? new Auth0ManagementHttpClient(auth0ManagementConfig)
    : new DisabledAuth0ManagementClient();

  /* USER */
  const { userRepository, userReadRepository, userAuthRepository } =
    createUserInfra(infra.primaryDb);

  const userLifecycleService = new UserLifecycleService(
    userRepository,
    userAuthRepository,
    authoritativeAuditGuard,
    adminMutationBridge,
    actorSnapshotCacheInvalidator,
    auth0ManagementClient,
    {
      databaseConnection: auth0ManagementConfig?.databaseConnection ?? "",
      passwordResetClientId: auth0ManagementConfig?.passwordResetClientId,
      passwordSetupDeliveryMode:
        auth0ManagementConfig?.passwordSetupDeliveryMode ?? "auth0_email",
      passwordSetupResultUrl: auth0ManagementConfig?.passwordSetupResultUrl,
    },
  );

  const userQueryService = new UserAdminQueryService(userReadRepository);

  const userMutationController = new UserAdminController(userLifecycleService);
  const userQueryController = new UserQueryAdminController(userQueryService);

  r.use("/users", userAdminRoutes(userMutationController, userQueryController));

  /* ROLE */
  const {
    roleRepository,
    userRoleAssignmentRepository,
    roleAssignmentRuleRepository,
    businessCodeSequenceRepository: roleBusinessCodeSequenceRepository,
    roleReadonlyAccess,
    roleReadRepository,
    roleAssignmentReadRepository,
  } = createRoleInfra(infra.primaryDb);
  const structuredScopeAuthority = new StructuredScopeAuthorityService(
    new NativeMongoStructuredScopeAuthorityReader(infra.primaryDb),
  );

  const roleService = new RoleAdminService(
    roleRepository,
    userRoleAssignmentRepository,
    roleAssignmentRuleRepository,
    roleBusinessCodeSequenceRepository,
    roleReadonlyAccess,
    userAuthRepository,
    authoritativeAuditGuard,
    adminMutationBridge,
    actorSnapshotCacheInvalidator,
  );

  const roleQueryService = new RoleAdminQueryService(
    roleReadRepository,
    roleAssignmentReadRepository,
  );

  const roleController = new AdminRoleController(roleService);
  const roleQueryController = new AdminRoleQueryController(roleQueryService);
  const roleTemplateController = new AdminRoleTemplateController(
    new RoleTemplateAdminService(),
  );

  r.use("/roles", adminRoleRoutes(roleController, roleQueryController));

  r.use("/role-templates", adminRoleTemplateRoutes(roleTemplateController));
  r.use(
    "/role-bundles",
    adminRoleBundleRoutes(
      new AdminRoleBundleController(
        new RoleBundleAdminService(roleRepository, roleService),
      ),
    ),
  );
  r.use(
    "/effective-access",
    adminEffectiveAccessRoutes(
      new AdminEffectiveAccessController(
        new EffectiveAccessAdminService(infra.primaryDb),
      ),
    ),
  );

  /* ORG UNIT */
  const {
    orgUnitRepository,
    businessCodeSequenceRepository: orgUnitBusinessCodeSequenceRepository,
    orgUnitReadRepository,
    orgUnitEmploymentReadonlyAccess,
    orgUnitPlatformAccountReadonlyAccess,
  } = createOrgUnitInfra(infra.primaryDb);

  const {
    employmentProfileRepository,
    businessCodeSequenceRepository:
      employmentProfileBusinessCodeSequenceRepository,
    employmentProfileReadRepository,
    employmentProfileOrgUnitReadonlyAccess,
    employmentProfileUserReadonlyAccess,
    employmentProfileTalentReadonlyAccess,
    employmentProfileWorkScheduleReadonlyAccess,
    employmentProfileEventAssignmentReadonlyAccess,
  } = createEmploymentProfileInfra(infra.primaryDb);
  const {
    employmentTermsRepository,
    employmentTermsCodeSequenceRepository,
  } = createEmploymentTermsInfra(infra.primaryDb);
  const {
    talentRepository,
    businessCodeSequenceRepository: talentBusinessCodeSequenceRepository,
    talentReadRepository,
    talentEmploymentProfileReadonlyAccess,
    talentTalentGroupReadonlyAccess,
    talentPlatformAccountReadonlyAccess,
    talentWorkScheduleReadonlyAccess,
    talentEventAssignmentReadonlyAccess,
  } = createTalentInfra(infra.primaryDb);
  const {
    talentGroupRepository,
    businessCodeSequenceRepository: talentGroupBusinessCodeSequenceRepository,
    talentGroupReadRepository,
    talentGroupTalentReadonlyAccess,
    talentGroupPlatformAccountReadonlyAccess,
    talentGroupWorkScheduleReadonlyAccess,
    talentGroupEventAssignmentReadonlyAccess,
  } = createTalentGroupInfra(infra.primaryDb);
  const {
    platformAccountRepository,
    businessCodeSequenceRepository:
      platformAccountBusinessCodeSequenceRepository,
    platformAccountReadRepository,
    platformAccountOrgUnitReadonlyAccess,
    platformAccountTalentReadonlyAccess,
    platformAccountTalentGroupReadonlyAccess,
    platformAccountEventAssignmentReadonlyAccess,
  } = createPlatformAccountInfra(infra.primaryDb);
  const {
    studioResourceRepository,
    businessCodeSequenceRepository:
      studioResourceBusinessCodeSequenceRepository,
    studioResourceReadRepository,
    studioResourceWorkScheduleReadonlyAccess,
    studioResourceEventAssignmentReadonlyAccess,
  } = createStudioResourceInfra(infra.primaryDb);
  const {
    workShiftRepository,
    workShiftCodeSequenceRepository,
    workShiftReadRepository,
    workPatternRepository,
    workPatternReadRepository,
    holidayCalendarRepository,
    holidayCalendarReadRepository,
    monthlyRosterRepository,
    monthlyRosterReadRepository,
    workScheduleRequestRepository,
    workScheduleRequestBatchRepository,
    workScheduleAvailabilityBatchRepository,
    workScheduleOrgUnitReadonlyAccess,
    workScheduleEmploymentProfileReadonlyAccess,
    workScheduleTalentReadonlyAccess,
    workScheduleTalentGroupReadonlyAccess,
    workScheduleStudioResourceReadonlyAccess,
  } = createWorkScheduleInfra(infra.primaryDb);
  const {
    eventAssignmentRepository,
    businessCodeSequenceRepository:
      eventAssignmentBusinessCodeSequenceRepository,
    eventAssignmentReadRepository,
    eventAssignmentEmploymentProfileReadonlyAccess,
    eventAssignmentTalentReadonlyAccess,
    eventAssignmentTalentGroupReadonlyAccess,
    eventAssignmentStudioResourceReadonlyAccess,
    eventAssignmentPlatformAccountReadonlyAccess,
  } = createEventAssignmentInfra(infra.primaryDb);
  const {
    contractRegistryRepository,
    businessCodeSequenceRepository:
      contractRegistryBusinessCodeSequenceRepository,
    contractRegistryReadRepository,
    contractRegistryEmploymentProfileReadonlyAccess,
    contractRegistryTalentReadonlyAccess,
    contractObligationRepository,
    contractObligationReadRepository,
    contractObligationEventEvidenceLinkRepository,
    contractObligationEventEvidenceLinkReadRepository,
  } = createContractRegistryInfra(infra.primaryDb);
  const {
    talentKpiRepository,
    businessCodeSequenceRepository: talentKpiBusinessCodeSequenceRepository,
    talentKpiReadRepository,
    talentKpiTalentReadonlyAccess,
    talentKpiPlatformAccountReadonlyAccess,
    talentKpiEventReadonlyAccess,
  } = createTalentKpiInfra(infra.primaryDb);
  const {
    kpiPlanRepository,
    kpiActualRepository,
    kpiBusinessCodeSequenceRepository,
    kpiSubjectReadonlyAccess,
    talentGroupManagerAssignmentRepository,
    orgUnitManagerAssignmentRepository,
  } = createKpiInfra(infra.primaryDb);
  const {
    commissionRepository,
    businessCodeSequenceRepository: commissionBusinessCodeSequenceRepository,
    commissionReadRepository,
    commissionEmploymentProfileReadonlyAccess,
    commissionTalentReadonlyAccess,
    commissionContractRegistryReadonlyAccess,
    commissionRevenueLedgerReadonlyAccess,
  } = createCommissionRevenueShareInfra(infra.primaryDb);
  const {
    platformEarningRepository,
    revenueEntryRepository,
    businessCodeSequenceRepository: revenueLedgerBusinessCodeSequenceRepository,
    revenueLedgerReadRepository,
    revenueLedgerTalentReadonlyAccess,
    revenueLedgerPlatformAccountReadonlyAccess,
    revenueLedgerEventReadonlyAccess,
    revenueLedgerCommissionReadonlyAccess,
  } = createRevenueLedgerInfra(infra.primaryDb);
  const { dashboardLiteReadRepository } = createDashboardLiteInfra(
    infra.primaryDb,
  );
  const {
    peopleReadinessReadRepository,
    employmentTermsReadinessReadonlyAccess,
  } = createPeopleReadinessInfra(
    infra.primaryDb,
  );

  const orgUnitService = new OrgUnitAdminService(
    orgUnitRepository,
    orgUnitBusinessCodeSequenceRepository,
    orgUnitEmploymentReadonlyAccess,
    orgUnitPlatformAccountReadonlyAccess,
    authoritativeAuditGuard,
    adminMutationBridge,
  );

  const orgUnitQueryService = new OrgUnitAdminQueryService(
    orgUnitReadRepository,
  );

  const orgUnitController = new OrgUnitAdminController(orgUnitService);
  const orgUnitQueryController = new OrgUnitAdminQueryController(
    orgUnitQueryService,
  );
  const orgUnitResponsibilityController =
    new OrgUnitResponsibilityAdminController(
      new OrgUnitResponsibilityAdminService(
        orgUnitRepository,
        orgUnitManagerAssignmentRepository,
        authoritativeAuditGuard,
        adminMutationBridge,
      ),
    );

  r.use(
    "/org-units",
    adminOrgUnitRoutes(
      orgUnitController,
      orgUnitQueryController,
      orgUnitResponsibilityController,
    ),
  );

  /* EMPLOYMENT PROFILE */
  const employmentProfileService = new EmploymentProfileAdminService(
    employmentProfileRepository,
    employmentProfileBusinessCodeSequenceRepository,
    employmentProfileOrgUnitReadonlyAccess,
    employmentProfileUserReadonlyAccess,
    employmentProfileTalentReadonlyAccess,
    employmentProfileWorkScheduleReadonlyAccess,
    employmentProfileEventAssignmentReadonlyAccess,
    authoritativeAuditGuard,
    adminMutationBridge,
  );

  const employmentProfileQueryService = new EmploymentProfileAdminQueryService(
    employmentProfileReadRepository,
  );

  const employmentProfileController = new EmploymentProfileAdminController(
    employmentProfileService,
  );
  const employmentProfileQueryController =
    new EmploymentProfileAdminQueryController(employmentProfileQueryService);

  r.use(
    "/employment-profiles",
    adminEmploymentProfileRoutes(
      employmentProfileController,
      employmentProfileQueryController,
    ),
  );

  const employmentTermsController = new EmploymentTermsAdminController(
    new EmploymentTermsAdminService(
      employmentTermsRepository,
      employmentTermsCodeSequenceRepository,
      employmentProfileRepository,
      authoritativeAuditGuard,
      adminMutationBridge,
    ),
  );

  r.use(
    "/employment-profiles/:employmentProfileId/employment-terms",
    adminEmploymentTermsRoutes(employmentTermsController),
  );
  r.use(
    "/employment-terms",
    adminEmploymentTermsAllProfilesRoutes(employmentTermsController),
  );

  /* TALENT */
  const talentService = new TalentAdminService(
    talentRepository,
    talentBusinessCodeSequenceRepository,
    talentEmploymentProfileReadonlyAccess,
    talentTalentGroupReadonlyAccess,
    talentPlatformAccountReadonlyAccess,
    talentWorkScheduleReadonlyAccess,
    talentEventAssignmentReadonlyAccess,
    authoritativeAuditGuard,
    adminMutationBridge,
  );

  const talentQueryService = new TalentAdminQueryService(talentReadRepository, {
    subjectReadonlyAccess: kpiSubjectReadonlyAccess,
    managerAssignmentRepository: talentGroupManagerAssignmentRepository,
  });

  const talentController = new TalentAdminController(talentService);
  const talentQueryController = new TalentAdminQueryController(
    talentQueryService,
  );

  r.use("/talents", adminTalentRoutes(talentController, talentQueryController));

  /* TALENT GROUP */
  const talentGroupService = new TalentGroupAdminService(
    talentGroupRepository,
    talentGroupBusinessCodeSequenceRepository,
    talentGroupTalentReadonlyAccess,
    talentGroupPlatformAccountReadonlyAccess,
    talentGroupWorkScheduleReadonlyAccess,
    talentGroupEventAssignmentReadonlyAccess,
    authoritativeAuditGuard,
    adminMutationBridge,
  );

  const talentGroupQueryService = new TalentGroupAdminQueryService(
    talentGroupReadRepository,
    {
      subjectReadonlyAccess: kpiSubjectReadonlyAccess,
      managerAssignmentRepository: talentGroupManagerAssignmentRepository,
    },
  );
  const talentGroupManagerAssignmentService =
    new TalentGroupManagerAssignmentAdminService(
      talentGroupRepository,
      talentGroupManagerAssignmentRepository,
      authoritativeAuditGuard,
      adminMutationBridge,
    );

  const talentGroupController = new TalentGroupAdminController(
    talentGroupService,
  );
  const talentGroupManagerAssignmentController =
    new TalentGroupManagerAssignmentAdminController(
      talentGroupManagerAssignmentService,
    );
  const talentGroupQueryController = new TalentGroupAdminQueryController(
    talentGroupQueryService,
  );

  r.use(
    "/talent-groups",
    adminTalentGroupRoutes(
      talentGroupController,
      talentGroupQueryController,
      talentGroupManagerAssignmentController,
    ),
  );

  /* PLATFORM ACCOUNT */
  const platformAccountService = new PlatformAccountAdminService(
    platformAccountRepository,
    platformAccountBusinessCodeSequenceRepository,
    platformAccountOrgUnitReadonlyAccess,
    platformAccountTalentReadonlyAccess,
    platformAccountTalentGroupReadonlyAccess,
    platformAccountEventAssignmentReadonlyAccess,
    authoritativeAuditGuard,
    adminMutationBridge,
  );

  const platformAccountQueryService = new PlatformAccountAdminQueryService(
    platformAccountReadRepository,
  );

  const platformAccountController = new PlatformAccountAdminController(
    platformAccountService,
  );
  const platformAccountQueryController =
    new PlatformAccountAdminQueryController(platformAccountQueryService);

  r.use(
    "/platform-accounts",
    adminPlatformAccountRoutes(
      platformAccountController,
      platformAccountQueryController,
    ),
  );

  /* STUDIO RESOURCE */
  const studioResourceService = new StudioResourceAdminService(
    studioResourceRepository,
    studioResourceBusinessCodeSequenceRepository,
    studioResourceWorkScheduleReadonlyAccess,
    studioResourceEventAssignmentReadonlyAccess,
    authoritativeAuditGuard,
    adminMutationBridge,
  );

  const studioResourceQueryService = new StudioResourceAdminQueryService(
    studioResourceReadRepository,
  );

  const studioResourceController = new StudioResourceAdminController(
    studioResourceService,
  );
  const studioResourceQueryController = new StudioResourceAdminQueryController(
    studioResourceQueryService,
  );

  r.use(
    "/studio-resources",
    adminStudioResourceRoutes(
      studioResourceController,
      studioResourceQueryController,
    ),
  );

  /* WORK SCHEDULE */
  const workScheduleService = new WorkScheduleAdminService(
    workShiftRepository,
    workShiftCodeSequenceRepository,
    workScheduleEmploymentProfileReadonlyAccess,
    workScheduleTalentReadonlyAccess,
    workScheduleTalentGroupReadonlyAccess,
    workScheduleStudioResourceReadonlyAccess,
    authoritativeAuditGuard,
    adminMutationBridge,
  );
  const workScheduleQueryService = new WorkScheduleAdminQueryService(
    workShiftReadRepository,
    workScheduleEmploymentProfileReadonlyAccess,
    talentGroupManagerAssignmentRepository,
  );
  const workScheduleController = new WorkScheduleAdminController(
    workScheduleService,
  );
  const workScheduleQueryController = new WorkScheduleAdminQueryController(
    workScheduleQueryService,
  );
  const workScheduleRequestService = new WorkScheduleRequestAdminService(
    workScheduleRequestRepository,
    workShiftRepository,
    workShiftCodeSequenceRepository,
    workScheduleEmploymentProfileReadonlyAccess,
    workScheduleStudioResourceReadonlyAccess,
    talentGroupManagerAssignmentRepository,
    authoritativeAuditGuard,
    adminMutationBridge,
  );
  const workScheduleRequestController =
    new WorkScheduleRequestAdminController(
      workScheduleRequestService,
    );
  const workScheduleRequestBatchService =
    new WorkScheduleRequestBatchAdminService(
      workScheduleRequestBatchRepository,
      workShiftRepository,
      workShiftCodeSequenceRepository,
      workScheduleEmploymentProfileReadonlyAccess,
      workScheduleStudioResourceReadonlyAccess,
      talentGroupManagerAssignmentRepository,
      orgUnitManagerAssignmentRepository,
      authoritativeAuditGuard,
      adminMutationBridge,
    );
  const workScheduleRequestBatchController =
    new WorkScheduleRequestBatchAdminController(
      workScheduleRequestBatchService,
    );
  const workScheduleAvailabilityBatchService =
    new WorkScheduleAvailabilityBatchAdminService(
      workScheduleAvailabilityBatchRepository,
      workShiftCodeSequenceRepository,
      workScheduleEmploymentProfileReadonlyAccess,
      workScheduleOrgUnitReadonlyAccess,
      workScheduleTalentGroupReadonlyAccess,
      talentGroupManagerAssignmentRepository,
      orgUnitManagerAssignmentRepository,
      authoritativeAuditGuard,
      adminMutationBridge,
      structuredScopeAuthority,
    );
  const workScheduleAvailabilityBatchController =
    new WorkScheduleAvailabilityBatchAdminController(
      workScheduleAvailabilityBatchService,
    );

  r.use(
    "/work-shifts",
    adminWorkScheduleRoutes(
      workScheduleController,
      workScheduleQueryController,
    ),
  );

  r.use(
    "/work-schedule/requests",
    adminWorkScheduleRequestRoutes(
      workScheduleRequestController,
    ),
  );

  r.use(
    "/work-schedule/request-batches",
    adminWorkScheduleRequestBatchRoutes(
      workScheduleRequestBatchController,
    ),
  );

  r.use(
    "/work-schedule/availability-batches",
    adminWorkScheduleAvailabilityBatchRoutes(
      workScheduleAvailabilityBatchController,
    ),
  );

  const workPatternService = new WorkPatternAdminService(
    workPatternRepository,
    workShiftCodeSequenceRepository,
    authoritativeAuditGuard,
    adminMutationBridge,
  );
  const workPatternQueryService = new WorkPatternAdminQueryService(
    workPatternReadRepository,
  );
  const workPatternController = new WorkPatternAdminController(
    workPatternService,
  );
  const workPatternQueryController = new WorkPatternAdminQueryController(
    workPatternQueryService,
  );

  r.use(
    "/work-schedule/patterns",
    adminWorkPatternRoutes(workPatternController, workPatternQueryController),
  );

  const holidayCalendarService = new HolidayCalendarAdminService(
    holidayCalendarRepository,
    workShiftCodeSequenceRepository,
    authoritativeAuditGuard,
    adminMutationBridge,
  );
  const holidayCalendarQueryService = new HolidayCalendarAdminQueryService(
    holidayCalendarReadRepository,
  );
  const holidayCalendarController = new HolidayCalendarAdminController(
    holidayCalendarService,
  );
  const holidayCalendarQueryController =
    new HolidayCalendarAdminQueryController(holidayCalendarQueryService);

  r.use(
    "/work-schedule/holiday-calendars",
    adminHolidayCalendarRoutes(
      holidayCalendarController,
      holidayCalendarQueryController,
    ),
  );

  const monthlyRosterService = new MonthlyRosterAdminService(
    monthlyRosterRepository,
    workPatternRepository,
    holidayCalendarRepository,
    workShiftRepository,
    workShiftCodeSequenceRepository,
    workScheduleOrgUnitReadonlyAccess,
    workScheduleEmploymentProfileReadonlyAccess,
    workScheduleStudioResourceReadonlyAccess,
    authoritativeAuditGuard,
    adminMutationBridge,
    workScheduleTalentGroupReadonlyAccess,
    undefined,
    undefined,
    workScheduleAvailabilityBatchRepository,
    structuredScopeAuthority,
  );
  const monthlyRosterQueryService = new MonthlyRosterAdminQueryService(
    monthlyRosterReadRepository,
    workScheduleEmploymentProfileReadonlyAccess,
    workPatternReadRepository,
    holidayCalendarReadRepository,
    workShiftReadRepository,
    workScheduleOrgUnitReadonlyAccess,
    workScheduleTalentGroupReadonlyAccess,
    structuredScopeAuthority,
  );
  const monthlyRosterController = new MonthlyRosterAdminController(
    monthlyRosterService,
  );
  const monthlyRosterQueryController = new MonthlyRosterAdminQueryController(
    monthlyRosterQueryService,
  );

  r.use(
    "/work-schedule/rosters",
    adminMonthlyRosterRoutes(
      monthlyRosterController,
      monthlyRosterQueryController,
    ),
  );

  /* EVENT ASSIGNMENT */
  const eventAssignmentService = new EventAssignmentAdminService(
    eventAssignmentRepository,
    eventAssignmentBusinessCodeSequenceRepository,
    eventAssignmentEmploymentProfileReadonlyAccess,
    eventAssignmentTalentReadonlyAccess,
    eventAssignmentTalentGroupReadonlyAccess,
    eventAssignmentStudioResourceReadonlyAccess,
    eventAssignmentPlatformAccountReadonlyAccess,
    authoritativeAuditGuard,
    adminMutationBridge,
  );
  const eventAssignmentQueryService = new EventAssignmentAdminQueryService(
    eventAssignmentReadRepository,
  );
  const eventAssignmentController = new EventAssignmentAdminController(
    eventAssignmentService,
  );
  const eventAssignmentQueryController =
    new EventAssignmentAdminQueryController(eventAssignmentQueryService);

  r.use(
    "/events",
    adminEventAssignmentRoutes(
      eventAssignmentController,
      eventAssignmentQueryController,
    ),
  );

  /* CONTRACT REGISTRY */
  const contractRegistryService = new ContractRegistryAdminService(
    contractRegistryRepository,
    contractObligationRepository,
    contractRegistryBusinessCodeSequenceRepository,
    contractRegistryEmploymentProfileReadonlyAccess,
    contractRegistryTalentReadonlyAccess,
    authoritativeAuditGuard,
    adminMutationBridge,
  );
  const contractRegistryQueryService = new ContractRegistryAdminQueryService(
    contractRegistryReadRepository,
  );
  const contractRegistryController = new ContractRegistryAdminController(
    contractRegistryService,
  );
  const contractRegistryQueryController =
    new ContractRegistryAdminQueryController(contractRegistryQueryService);
  const contractObligationController =
    new ContractObligationAdminController(
      new ContractObligationAdminService(
        contractObligationRepository,
        contractObligationEventEvidenceLinkRepository,
        contractRegistryRepository,
        contractRegistryBusinessCodeSequenceRepository,
        contractRegistryEmploymentProfileReadonlyAccess,
        authoritativeAuditGuard,
        adminMutationBridge,
      ),
      new ContractObligationAdminQueryService(
        contractObligationReadRepository,
      ),
    );
  const contractObligationEventEvidenceLinkController =
    new ContractObligationEventEvidenceLinkAdminController(
      new ContractObligationEventEvidenceLinkAdminService(
        contractObligationEventEvidenceLinkRepository,
        contractObligationRepository,
        contractRegistryRepository,
        eventAssignmentRepository,
        authoritativeAuditGuard,
        adminMutationBridge,
      ),
      new ContractObligationEventEvidenceLinkAdminQueryService(
        contractObligationEventEvidenceLinkReadRepository,
      ),
    );

  r.use(
    "/contract-records",
    adminContractRegistryRoutes(
      contractRegistryController,
      contractRegistryQueryController,
      contractObligationController,
      contractObligationEventEvidenceLinkController,
    ),
  );

  /* TALENT KPI */
  const talentKpiService = new TalentKpiAdminService(
    talentKpiRepository,
    talentKpiBusinessCodeSequenceRepository,
    talentKpiTalentReadonlyAccess,
    talentKpiPlatformAccountReadonlyAccess,
    talentKpiEventReadonlyAccess,
    authoritativeAuditGuard,
    adminMutationBridge,
  );
  const talentKpiQueryService = new TalentKpiAdminQueryService(
    talentKpiReadRepository,
  );
  const talentKpiController = new TalentKpiAdminController(talentKpiService);
  const talentKpiQueryController = new TalentKpiAdminQueryController(
    talentKpiQueryService,
  );

  r.use(
    "/talent-kpi-records",
    adminTalentKpiRoutes(talentKpiController, talentKpiQueryController),
  );

  /* KPI V2 */
  const kpiService = new KpiAdminService(
    kpiPlanRepository,
    kpiActualRepository,
    kpiBusinessCodeSequenceRepository,
    kpiSubjectReadonlyAccess,
    talentGroupManagerAssignmentRepository,
    orgUnitManagerAssignmentRepository,
    authoritativeAuditGuard,
    adminMutationBridge,
  );
  const kpiController = new KpiAdminController(kpiService);
  const kpiQueryController = new KpiAdminQueryController(kpiService);

  r.use("/kpi", adminKpiRoutes(kpiController, kpiQueryController));

  const managerWorkspaceController = new ManagerWorkspaceAdminController(
    new ManagerWorkspaceAdminService(
      employmentProfileRepository,
      kpiSubjectReadonlyAccess,
      talentGroupManagerAssignmentRepository,
      orgUnitManagerAssignmentRepository,
      structuredScopeAuthority,
    ),
    new ManagerWorkspaceWorkScheduleAdminService(
      employmentProfileRepository,
      workScheduleEmploymentProfileReadonlyAccess,
      talentGroupManagerAssignmentRepository,
      orgUnitManagerAssignmentRepository,
      workShiftReadRepository,
      structuredScopeAuthority,
    ),
    workScheduleRequestBatchService,
    workScheduleAvailabilityBatchService,
    new ManagerWorkspaceEventAdminService(
      employmentProfileRepository,
      talentGroupManagerAssignmentRepository,
      orgUnitManagerAssignmentRepository,
      eventAssignmentReadRepository,
      structuredScopeAuthority,
    ),
    new ManagerWorkspaceRevenueAdminService(
      employmentProfileRepository,
      talentGroupManagerAssignmentRepository,
      platformAccountRepository,
      platformAccountReadRepository,
      workScheduleEmploymentProfileReadonlyAccess,
      platformEarningRepository,
      revenueLedgerBusinessCodeSequenceRepository,
      authoritativeAuditGuard,
      adminMutationBridge,
      structuredScopeAuthority,
    ),
  );

  r.use(
    "/manager-workspace",
    adminManagerWorkspaceRoutes(managerWorkspaceController),
  );

  /* COMMISSION */
  const commissionService = new CommissionAdminService(
    commissionRepository,
    commissionBusinessCodeSequenceRepository,
    commissionEmploymentProfileReadonlyAccess,
    commissionTalentReadonlyAccess,
    commissionContractRegistryReadonlyAccess,
    commissionRevenueLedgerReadonlyAccess,
    authoritativeAuditGuard,
    adminMutationBridge,
  );
  const commissionQueryService = new CommissionAdminQueryService(
    commissionReadRepository,
  );
  const commissionController = new CommissionAdminController(commissionService);
  const commissionQueryController = new CommissionAdminQueryController(
    commissionQueryService,
  );

  r.use(
    "/commission",
    adminCommissionRoutes(commissionController, commissionQueryController),
  );

  /* REVENUE LEDGER */
  const revenueLedgerService = new RevenueLedgerAdminService(
    revenueEntryRepository,
    revenueLedgerBusinessCodeSequenceRepository,
    revenueLedgerTalentReadonlyAccess,
    revenueLedgerPlatformAccountReadonlyAccess,
    revenueLedgerEventReadonlyAccess,
    revenueLedgerCommissionReadonlyAccess,
    authoritativeAuditGuard,
    adminMutationBridge,
  );
  const revenueLedgerQueryService = new RevenueLedgerAdminQueryService(
    revenueLedgerReadRepository,
  );
  const revenueLedgerController = new RevenueLedgerAdminController(
    revenueLedgerService,
  );
  const revenueLedgerQueryController = new RevenueLedgerAdminQueryController(
    revenueLedgerQueryService,
  );
  const platformEarningService = new PlatformEarningAdminService(
    platformEarningRepository,
    revenueEntryRepository,
    revenueLedgerBusinessCodeSequenceRepository,
    revenueLedgerTalentReadonlyAccess,
    revenueLedgerPlatformAccountReadonlyAccess,
    revenueLedgerEventReadonlyAccess,
    authoritativeAuditGuard,
    adminMutationBridge,
  );
  const platformEarningController =
    new PlatformEarningAdminController(
      platformEarningService,
    );

  r.use(
    "/revenue-entries",
    adminRevenueLedgerRoutes(
      revenueLedgerController,
      revenueLedgerQueryController,
    ),
  );
  r.use(
    "/revenue-ledger",
    adminPlatformEarningRoutes(
      platformEarningController,
    ),
  );

  /* DASHBOARD LITE */
  const dashboardLiteQueryService = new DashboardLiteAdminQueryService(
    dashboardLiteReadRepository,
  );
  const dashboardLiteQueryController = new DashboardLiteAdminQueryController(
    dashboardLiteQueryService,
  );

  r.use(
    "/dashboard-lite",
    adminDashboardLiteRoutes(dashboardLiteQueryController),
  );

  r.use(
    "/people-readiness",
    adminPeopleReadinessRoutes(
      new PeopleReadinessAdminController(
        new PeopleReadinessAdminService(
          peopleReadinessReadRepository,
          employmentTermsReadinessReadonlyAccess,
        ),
      ),
    ),
  );

  return r;
}
