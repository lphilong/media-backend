import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { HolidayCalendarAdminController } from "./admin.holiday-calendar.controller";
import { HolidayCalendarAdminQueryController } from "./admin.holiday-calendar.query.controller";

export function adminHolidayCalendarRoutes(
  mutationController: HolidayCalendarAdminController,
  queryController: HolidayCalendarAdminQueryController,
): Router {
  const router = Router();

  router.post(
    "/",
    withCommand("HOLIDAY_CALENDAR_CREATE"),
    mutationController.execute,
  );

  router.get(
    "/",
    withCommand("HOLIDAY_CALENDAR_LIST"),
    queryController.execute,
  );

  router.get(
    "/:holidayCalendarId",
    withCommand("HOLIDAY_CALENDAR_GET_DETAIL"),
    queryController.execute,
  );

  router.patch(
    "/:holidayCalendarId",
    withCommand("HOLIDAY_CALENDAR_UPDATE"),
    mutationController.execute,
  );

  router.post(
    "/:holidayCalendarId/activate",
    withCommand("HOLIDAY_CALENDAR_ACTIVATE"),
    mutationController.execute,
  );

  router.post(
    "/:holidayCalendarId/archive",
    withCommand("HOLIDAY_CALENDAR_ARCHIVE"),
    mutationController.execute,
  );

  router.post(
    "/:holidayCalendarId/entries",
    withCommand("HOLIDAY_CALENDAR_ENTRY_ADD"),
    mutationController.execute,
  );

  router.patch(
    "/:holidayCalendarId/entries/:holidayCalendarEntryId",
    withCommand("HOLIDAY_CALENDAR_ENTRY_UPDATE"),
    mutationController.execute,
  );

  router.post(
    "/:holidayCalendarId/entries/:holidayCalendarEntryId/remove",
    withCommand("HOLIDAY_CALENDAR_ENTRY_REMOVE"),
    mutationController.execute,
  );

  return router;
}
