import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { InfraModule } from "@infra/infra.module";
import { createUserInfra } from "@infra/providers/user.infra";
import { createRoleInfra } from "@infra/providers/role.infra";
import { createOrgUnitInfra } from "@infra/providers/org-unit.infra";
import { createEmploymentProfileInfra } from "@infra/providers/employment-profile.infra";
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
import { auditScopeMiddleware } from "@core/audit/audit.scope.middleware";
import { MongoAuthoritativeAdminMutationBridge } from "@core/application/mongo-authoritative-admin-mutation.bridge";
import { AuditGuard } from "@core/audit/audit.guard";
import { MongoAuditLogger } from "@core/audit/mongo.audit.logger";
import { MongoAuditWriteRepository } from "@infra/mongo/audit/audit.write.repository";
import { AuditContext } from "@core/audit/audit.context";
import { ActorSnapshotCacheInvalidator } from "@infra/cache/actor.snapshot.cache";
import { CurrentActorCapabilitiesController } from "./current-actor-capabilities.controller";

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

/* ORG UNIT */
import { adminOrgUnitRoutes } from "@modules/org-unit/admin/admin.org-unit.routes";
import { OrgUnitAdminController } from "@modules/org-unit/admin/admin.org-unit.controller";
import { OrgUnitAdminQueryController } from "@modules/org-unit/admin/admin.org-unit.query.controller";
import { OrgUnitAdminService } from "@modules/org-unit/admin/admin.org-unit.service";
import { OrgUnitAdminQueryService } from "@modules/org-unit/admin/admin.org-unit.query-service";

/* EMPLOYMENT PROFILE */
import { adminEmploymentProfileRoutes } from "@modules/employment-profile/admin/admin.employment-profile.routes";
import { EmploymentProfileAdminController } from "@modules/employment-profile/admin/admin.employment-profile.controller";
import { EmploymentProfileAdminQueryController } from "@modules/employment-profile/admin/admin.employment-profile.query.controller";
import { EmploymentProfileAdminService } from "@modules/employment-profile/admin/admin.employment-profile.service";
import { EmploymentProfileAdminQueryService } from "@modules/employment-profile/admin/admin.employment-profile.query-service";

/* TALENT */
import { adminTalentRoutes } from "@modules/talent/admin/admin.talent.routes";
import { TalentAdminController } from "@modules/talent/admin/admin.talent.controller";
import { TalentAdminQueryController } from "@modules/talent/admin/admin.talent.query.controller";
import { TalentAdminService } from "@modules/talent/admin/admin.talent.service";
import { TalentAdminQueryService } from "@modules/talent/admin/admin.talent.query-service";

/* TALENT GROUP */
import { TalentGroupAdminService } from "@modules/talent-group/admin/admin.talent-group.service";
import { TalentGroupAdminQueryService } from "@modules/talent-group/admin/admin.talent-group.query-service";
import { TalentGroupAdminController } from "@modules/talent-group/admin/admin.talent-group.controller";
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

/* COMMISSION */
import { adminCommissionRoutes } from "@modules/commission/admin/admin.commission.routes";
import { CommissionAdminController } from "@modules/commission/admin/admin.commission.controller";
import { CommissionAdminQueryController } from "@modules/commission/admin/admin.commission.query.controller";
import { CommissionAdminService } from "@modules/commission/admin/admin.commission.service";
import { CommissionAdminQueryService } from "@modules/commission/admin/admin.commission.query-service";

/* REVENUE LEDGER */
import { adminRevenueLedgerRoutes } from "@modules/revenue-ledger/admin/admin.revenue-ledger.routes";
import { RevenueLedgerAdminController } from "@modules/revenue-ledger/admin/admin.revenue-ledger.controller";
import { RevenueLedgerAdminQueryController } from "@modules/revenue-ledger/admin/admin.revenue-ledger.query.controller";
import { RevenueLedgerAdminService } from "@modules/revenue-ledger/admin/admin.revenue-ledger.service";
import { RevenueLedgerAdminQueryService } from "@modules/revenue-ledger/admin/admin.revenue-ledger.query-service";

/* DASHBOARD LITE */
import { adminDashboardLiteRoutes } from "@modules/dashboard-lite/admin/admin.dashboard-lite.routes";
import { DashboardLiteAdminQueryController } from "@modules/dashboard-lite/admin/admin.dashboard-lite.query.controller";
import { DashboardLiteAdminQueryService } from "@modules/dashboard-lite/admin/admin.dashboard-lite.query-service";

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

  /* USER */
  const { userRepository, userReadRepository, userAuthRepository } =
    createUserInfra(infra.primaryDb);

  const userLifecycleService = new UserLifecycleService(
    userRepository,
    userAuthRepository,
    authoritativeAuditGuard,
    adminMutationBridge,
    actorSnapshotCacheInvalidator,
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
    roleReadonlyAccess,
    roleReadRepository,
    roleAssignmentReadRepository,
  } = createRoleInfra(infra.primaryDb);

  const roleService = new RoleAdminService(
    roleRepository,
    userRoleAssignmentRepository,
    roleAssignmentRuleRepository,
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

  r.use(
    "/org-units",
    adminOrgUnitRoutes(orgUnitController, orgUnitQueryController),
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

  const talentQueryService = new TalentAdminQueryService(talentReadRepository);

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
  );

  const talentGroupController = new TalentGroupAdminController(
    talentGroupService,
  );
  const talentGroupQueryController = new TalentGroupAdminQueryController(
    talentGroupQueryService,
  );

  r.use(
    "/talent-groups",
    adminTalentGroupRoutes(talentGroupController, talentGroupQueryController),
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
  );
  const workScheduleController = new WorkScheduleAdminController(
    workScheduleService,
  );
  const workScheduleQueryController = new WorkScheduleAdminQueryController(
    workScheduleQueryService,
  );

  r.use(
    "/work-shifts",
    adminWorkScheduleRoutes(
      workScheduleController,
      workScheduleQueryController,
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
  );
  const monthlyRosterQueryService = new MonthlyRosterAdminQueryService(
    monthlyRosterReadRepository,
    workScheduleEmploymentProfileReadonlyAccess,
    workPatternReadRepository,
    holidayCalendarReadRepository,
    workShiftReadRepository,
    workScheduleOrgUnitReadonlyAccess,
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

  r.use(
    "/contract-records",
    adminContractRegistryRoutes(
      contractRegistryController,
      contractRegistryQueryController,
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
    authoritativeAuditGuard,
    adminMutationBridge,
  );
  const kpiController = new KpiAdminController(kpiService);
  const kpiQueryController = new KpiAdminQueryController(kpiService);

  r.use("/kpi", adminKpiRoutes(kpiController, kpiQueryController));

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

  r.use(
    "/revenue-entries",
    adminRevenueLedgerRoutes(
      revenueLedgerController,
      revenueLedgerQueryController,
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

  return r;
}
