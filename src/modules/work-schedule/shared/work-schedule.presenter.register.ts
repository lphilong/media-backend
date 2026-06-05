import { PresenterRegistryWriter } from "@app/presenter/presenter.runtime-access";
import {
  WORK_SCHEDULE_ADMIN_BY_RESOURCE_LIST_PRESENTER_KEY,
  WORK_SCHEDULE_ADMIN_BY_SUBJECT_LIST_PRESENTER_KEY,
  WORK_SCHEDULE_ADMIN_DETAIL_PRESENTER_KEY,
  WORK_SCHEDULE_ADMIN_LIST_PRESENTER_KEY,
  WORK_SCHEDULE_ADMIN_MUTATION_PRESENTER_KEY,
  WORK_SCHEDULE_REQUEST_ADMIN_DETAIL_PRESENTER_KEY,
  WORK_SCHEDULE_REQUEST_ADMIN_LIST_PRESENTER_KEY,
  WORK_SCHEDULE_REQUEST_ADMIN_MUTATION_PRESENTER_KEY,
  WORK_SCHEDULE_REQUEST_BATCH_ADMIN_DETAIL_PRESENTER_KEY,
  WORK_SCHEDULE_REQUEST_BATCH_ADMIN_LIST_PRESENTER_KEY,
  WORK_SCHEDULE_REQUEST_BATCH_ADMIN_MUTATION_PRESENTER_KEY,
  WORK_PATTERN_ADMIN_DETAIL_PRESENTER_KEY,
  WORK_PATTERN_ADMIN_LIST_PRESENTER_KEY,
  WORK_PATTERN_ADMIN_MUTATION_PRESENTER_KEY,
  HOLIDAY_CALENDAR_ADMIN_DETAIL_PRESENTER_KEY,
  HOLIDAY_CALENDAR_ADMIN_LIST_PRESENTER_KEY,
  HOLIDAY_CALENDAR_ADMIN_MUTATION_PRESENTER_KEY,
  MONTHLY_ROSTER_ADMIN_DETAIL_PRESENTER_KEY,
  MONTHLY_ROSTER_ADMIN_LIST_PRESENTER_KEY,
  MONTHLY_ROSTER_ADMIN_MUTATION_PRESENTER_KEY,
  MONTHLY_ROSTER_ADMIN_PREVIEW_PRESENTER_KEY,
} from "./work-schedule.presenter-keys";
import {
  WorkScheduleAdminByResourceListPresenter,
  WorkScheduleAdminBySubjectListPresenter,
  WorkScheduleAdminDetailPresenter,
  WorkScheduleAdminListPresenter,
  WorkScheduleAdminMutationPresenter,
  WorkScheduleRequestAdminDetailPresenter,
  WorkScheduleRequestAdminListPresenter,
  WorkScheduleRequestAdminMutationPresenter,
  WorkScheduleRequestBatchAdminDetailPresenter,
  WorkScheduleRequestBatchAdminListPresenter,
  WorkScheduleRequestBatchAdminMutationPresenter,
  WorkPatternAdminDetailPresenter,
  WorkPatternAdminListPresenter,
  WorkPatternAdminMutationPresenter,
  HolidayCalendarAdminDetailPresenter,
  HolidayCalendarAdminListPresenter,
  HolidayCalendarAdminMutationPresenter,
  MonthlyRosterAdminDetailPresenter,
  MonthlyRosterAdminListPresenter,
  MonthlyRosterAdminMutationPresenter,
  MonthlyRosterAdminPreviewPresenter,
} from "./work-schedule.presenter";

export function registerPresenters(
  registry: PresenterRegistryWriter,
): void {
  registry.register(
    WORK_SCHEDULE_ADMIN_MUTATION_PRESENTER_KEY,
    new WorkScheduleAdminMutationPresenter(),
  );

  registry.register(
    WORK_SCHEDULE_ADMIN_LIST_PRESENTER_KEY,
    new WorkScheduleAdminListPresenter(),
  );

  registry.register(
    WORK_SCHEDULE_ADMIN_BY_SUBJECT_LIST_PRESENTER_KEY,
    new WorkScheduleAdminBySubjectListPresenter(),
  );

  registry.register(
    WORK_SCHEDULE_ADMIN_BY_RESOURCE_LIST_PRESENTER_KEY,
    new WorkScheduleAdminByResourceListPresenter(),
  );

  registry.register(
    WORK_SCHEDULE_ADMIN_DETAIL_PRESENTER_KEY,
    new WorkScheduleAdminDetailPresenter(),
  );

  registry.register(
    WORK_SCHEDULE_REQUEST_ADMIN_MUTATION_PRESENTER_KEY,
    new WorkScheduleRequestAdminMutationPresenter(),
  );

  registry.register(
    WORK_SCHEDULE_REQUEST_ADMIN_LIST_PRESENTER_KEY,
    new WorkScheduleRequestAdminListPresenter(),
  );

  registry.register(
    WORK_SCHEDULE_REQUEST_ADMIN_DETAIL_PRESENTER_KEY,
    new WorkScheduleRequestAdminDetailPresenter(),
  );

  registry.register(
    WORK_SCHEDULE_REQUEST_BATCH_ADMIN_MUTATION_PRESENTER_KEY,
    new WorkScheduleRequestBatchAdminMutationPresenter(),
  );

  registry.register(
    WORK_SCHEDULE_REQUEST_BATCH_ADMIN_LIST_PRESENTER_KEY,
    new WorkScheduleRequestBatchAdminListPresenter(),
  );

  registry.register(
    WORK_SCHEDULE_REQUEST_BATCH_ADMIN_DETAIL_PRESENTER_KEY,
    new WorkScheduleRequestBatchAdminDetailPresenter(),
  );

  registry.register(
    WORK_PATTERN_ADMIN_MUTATION_PRESENTER_KEY,
    new WorkPatternAdminMutationPresenter(),
  );

  registry.register(
    WORK_PATTERN_ADMIN_LIST_PRESENTER_KEY,
    new WorkPatternAdminListPresenter(),
  );

  registry.register(
    WORK_PATTERN_ADMIN_DETAIL_PRESENTER_KEY,
    new WorkPatternAdminDetailPresenter(),
  );

  registry.register(
    HOLIDAY_CALENDAR_ADMIN_MUTATION_PRESENTER_KEY,
    new HolidayCalendarAdminMutationPresenter(),
  );

  registry.register(
    HOLIDAY_CALENDAR_ADMIN_LIST_PRESENTER_KEY,
    new HolidayCalendarAdminListPresenter(),
  );

  registry.register(
    HOLIDAY_CALENDAR_ADMIN_DETAIL_PRESENTER_KEY,
    new HolidayCalendarAdminDetailPresenter(),
  );

  registry.register(
    MONTHLY_ROSTER_ADMIN_MUTATION_PRESENTER_KEY,
    new MonthlyRosterAdminMutationPresenter(),
  );

  registry.register(
    MONTHLY_ROSTER_ADMIN_LIST_PRESENTER_KEY,
    new MonthlyRosterAdminListPresenter(),
  );

  registry.register(
    MONTHLY_ROSTER_ADMIN_DETAIL_PRESENTER_KEY,
    new MonthlyRosterAdminDetailPresenter(),
  );

  registry.register(
    MONTHLY_ROSTER_ADMIN_PREVIEW_PRESENTER_KEY,
    new MonthlyRosterAdminPreviewPresenter(),
  );
}
