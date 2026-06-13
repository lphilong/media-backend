export enum Permission {
  /* =========================
     USER
  ========================= */
  USER_VIEW = "user:view",
  USER_CREATE = "user:create",
  USER_EDIT = "user:edit",
  USER_ACTIVATE = "user:activate",
  USER_DISABLE = "user:disable",
  USER_ARCHIVE = "user:archive",
  USER_AUTH_LINKAGE_SET = "user:auth_linkage:set",
  USER_PROVISION_ACCOUNT = "user:provision_account",
  USER_AUTH_LINKAGE_UNLINK = "user:auth_linkage:unlink",
  USER_PASSWORD_SETUP_SEND = "user:password_setup:send",
  USER_ACTOR_KIND_UPDATE = "user:actor_kind:update",

  
  /* =========================
     ROLE
  ========================= */
  ROLE_LIST = "role:list",
  ROLE_VIEW = "role:view",
  ROLE_CREATE = "role:create",
  ROLE_UPDATE = "role:update",
  ROLE_ACTIVATE = "role:activate",
  ROLE_DEACTIVATE = "role:deactivate",
  ROLE_ARCHIVE = "role:archive",
  ROLE_PERMISSION_ASSIGN = "role:permission:assign",
  ROLE_ASSIGNMENT_RULE_SET = "role:assignment_rule:set",
  ROLE_ASSIGN_TO_USER = "role:assign_to_user",
  ROLE_REVOKE_FROM_USER = "role:revoke_from_user",
  ROLE_ASSIGNMENT_VIEW = "role:assignment:view",

  /* =========================
     ORG UNIT
  ========================= */
  ORG_UNIT_READ = "orgUnit.read",
  ORG_UNIT_LOOKUP = "orgUnit.lookup",
  ORG_UNIT_CREATE = "orgUnit.create",
  ORG_UNIT_UPDATE = "orgUnit.update",
  ORG_UNIT_MANAGE_HIERARCHY = "orgUnit.manageHierarchy",
  ORG_UNIT_MANAGE_LIFECYCLE = "orgUnit.manageLifecycle",

  /* =========================
     EMPLOYMENT PROFILE
  ========================= */
  EMPLOYMENT_PROFILE_READ = "employmentProfile.read",
  EMPLOYMENT_PROFILE_LOOKUP = "employmentProfile.lookup",
  EMPLOYMENT_PROFILE_CREATE = "employmentProfile.create",
  EMPLOYMENT_PROFILE_UPDATE = "employmentProfile.update",
  EMPLOYMENT_PROFILE_MANAGE_ORG_ASSIGNMENT = "employmentProfile.manageOrgAssignment",
  EMPLOYMENT_PROFILE_MANAGE_MANAGER_ASSIGNMENT = "employmentProfile.manageManagerAssignment",
  EMPLOYMENT_PROFILE_MANAGE_USER_LINKAGE = "employmentProfile.manageUserLinkage",
  EMPLOYMENT_PROFILE_MANAGE_LIFECYCLE = "employmentProfile.manageLifecycle",

  /* =========================
     EMPLOYMENT TERMS
  ========================= */
  EMPLOYMENT_TERMS_READ = "employmentTerms.read",
  EMPLOYMENT_TERMS_READ_SENSITIVE = "employmentTerms.readSensitive",
  EMPLOYMENT_TERMS_MANAGE_DRAFT = "employmentTerms.manageDraft",
  EMPLOYMENT_TERMS_APPROVE = "employmentTerms.approve",
  EMPLOYMENT_TERMS_AUDIT = "employmentTerms.audit",

  /* =========================
     TALENT
  ========================= */
  TALENT_READ = "talent.read",
  TALENT_LOOKUP = "talent.lookup",
  TALENT_CREATE = "talent.create",
  TALENT_UPDATE = "talent.update",
  TALENT_MANAGE_MANAGER = "talent.manageManager",
  TALENT_MANAGE_EMPLOYMENT_LINK = "talent.manageEmploymentLink",
  TALENT_MANAGE_LIFECYCLE = "talent.manageLifecycle",
  TALENT_MANAGE_COMMERCIAL_PARTICIPATION = "talent.manageCommercialParticipation",

  /* =========================
     TALENT GROUP
  ========================= */
  TALENT_GROUP_READ = "talentGroup.read",
  TALENT_GROUP_LOOKUP = "talentGroup.lookup",
  TALENT_GROUP_CREATE = "talentGroup.create",
  TALENT_GROUP_UPDATE = "talentGroup.update",
  TALENT_GROUP_MANAGE_LIFECYCLE = "talentGroup.manageLifecycle",
  TALENT_GROUP_MANAGE_MEMBERSHIP = "talentGroup.manageMembership",

  /* =========================
     PLATFORM ACCOUNT
  ========================= */
  PLATFORM_ACCOUNT_READ = "platformAccount.read",
  PLATFORM_ACCOUNT_LOOKUP = "platformAccount.lookup",
  PLATFORM_ACCOUNT_CREATE = "platformAccount.create",
  PLATFORM_ACCOUNT_UPDATE = "platformAccount.update",
  PLATFORM_ACCOUNT_MANAGE_OWNERSHIP = "platformAccount.manageOwnership",
  PLATFORM_ACCOUNT_MANAGE_LIFECYCLE = "platformAccount.manageLifecycle",
  PLATFORM_ACCOUNT_MANAGE_CAPABILITIES = "platformAccount.manageCapabilities",

  /* =========================
     STUDIO RESOURCE
  ========================= */
  STUDIO_RESOURCE_READ = "studioResource.read",
  STUDIO_RESOURCE_LOOKUP = "studioResource.lookup",
  STUDIO_RESOURCE_CREATE = "studioResource.create",
  STUDIO_RESOURCE_UPDATE = "studioResource.update",
  STUDIO_RESOURCE_MANAGE_AVAILABILITY = "studioResource.manageAvailability",
  STUDIO_RESOURCE_MANAGE_LIFECYCLE = "studioResource.manageLifecycle",

  /* =========================
     EVENT ASSIGNMENT
  ========================= */
  EVENT_READ = "event.read",
  EVENT_LOOKUP = "event.lookup",
  EVENT_CREATE = "event.create",
  EVENT_UPDATE = "event.update",
  EVENT_MANAGE_ASSIGNMENTS = "event.manageAssignments",
  EVENT_MANAGE_LIFECYCLE = "event.manageLifecycle",

  /* =========================
     WORK SCHEDULE
  ========================= */
  WORK_SCHEDULE_READ = "workSchedule.read",
  WORK_SCHEDULE_CREATE = "workSchedule.create",
  WORK_SCHEDULE_UPDATE = "workSchedule.update",
  WORK_SCHEDULE_MANAGE_LIFECYCLE = "workSchedule.manageLifecycle",

  /* =========================
     CONTRACT REGISTRY
  ========================= */
  CONTRACT_REGISTRY_READ = "contractRegistry.read",
  CONTRACT_REGISTRY_LOOKUP = "contractRegistry.lookup",
  CONTRACT_REGISTRY_CREATE = "contractRegistry.create",
  CONTRACT_REGISTRY_UPDATE = "contractRegistry.update",
  CONTRACT_REGISTRY_MANAGE_OWNER = "contractRegistry.manageOwner",
  CONTRACT_REGISTRY_MANAGE_FILE_REFERENCE = "contractRegistry.manageFileReference",
  CONTRACT_REGISTRY_MANAGE_LIFECYCLE = "contractRegistry.manageLifecycle",
  CONTRACT_OBLIGATION_READ = "contractObligation.read",
  CONTRACT_OBLIGATION_MANAGE_DRAFT = "contractObligation.manageDraft",
  CONTRACT_OBLIGATION_DELIVER = "contractObligation.deliver",
  CONTRACT_OBLIGATION_REVIEW = "contractObligation.review",
  CONTRACT_OBLIGATION_MANAGE_LIFECYCLE = "contractObligation.manageLifecycle",

  /* =========================
     TALENT KPI
  ========================= */
  TALENT_KPI_READ = "talentKpi.read",
  TALENT_KPI_CREATE = "talentKpi.create",
  TALENT_KPI_UPDATE = "talentKpi.update",
  TALENT_KPI_MANAGE_METRICS = "talentKpi.manageMetrics",
  TALENT_KPI_MANAGE_LIFECYCLE = "talentKpi.manageLifecycle",

  /* =========================
     KPI V2
  ========================= */
  KPI_READ = "kpi.read",
  KPI_CREATE_PLAN = "kpi.createPlan",
  KPI_UPDATE_DRAFT = "kpi.updateDraft",
  KPI_PUBLISH = "kpi.publish",
  KPI_MANAGE_ALLOCATION = "kpi.manageAllocation",
  KPI_ARCHIVE = "kpi.archive",
  KPI_ENTER_ACTUAL = "kpi.enterActual",
  KPI_CORRECT_ACTUAL = "kpi.correctActual",
  KPI_READ_PROGRESS = "kpi.readProgress",
  KPI_FINALIZE = "kpi.finalize",

  /* =========================
     COMMISSION
  ========================= */
  COMMISSION_RULE_READ = "commissionRule.read",
  COMMISSION_RULE_LOOKUP = "commissionRule.lookup",
  COMMISSION_RULE_CREATE = "commissionRule.create",
  COMMISSION_RULE_UPDATE = "commissionRule.update",
  COMMISSION_RULE_MANAGE_LIFECYCLE = "commissionRule.manageLifecycle",
  COMMISSION_SETTLEMENT_READ = "commissionSettlement.read",
  COMMISSION_SETTLEMENT_CREATE = "commissionSettlement.create",
  COMMISSION_SETTLEMENT_UPDATE = "commissionSettlement.update",
  COMMISSION_SETTLEMENT_MANAGE_LIFECYCLE = "commissionSettlement.manageLifecycle",

  /* =========================
     REVENUE LEDGER
  ========================= */
  REVENUE_LEDGER_READ = "revenueLedger.read",
  REVENUE_LEDGER_LOOKUP = "revenueLedger.lookup",
  REVENUE_LEDGER_CREATE = "revenueLedger.create",
  REVENUE_LEDGER_UPDATE = "revenueLedger.update",
  REVENUE_LEDGER_MANAGE_LIFECYCLE = "revenueLedger.manageLifecycle",
  REVENUE_LEDGER_RECONCILE = "revenueLedger.reconcile",

  /* =========================
     DASHBOARD LITE
  ========================= */
  DASHBOARD_LITE_READ = "dashboardLite.read",
}
