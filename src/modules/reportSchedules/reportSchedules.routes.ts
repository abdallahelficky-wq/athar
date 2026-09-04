import { Router } from "express";
import { authenticate, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { upsertReportScheduleSchema } from "./reportSchedules.schemas";
import * as controller from "./reportSchedules.controller";

const canWrite = requireRole("admin", "finance_manager");

// تُركَّب على /api/companies/:companyId/report-schedule
export const reportScheduleRoutes = Router({ mergeParams: true });
reportScheduleRoutes.use(authenticate, blockMutationsWhenReadOnly);
reportScheduleRoutes.get("/report-schedule", controller.getReportScheduleHandler);
reportScheduleRoutes.put("/report-schedule", canWrite, validateBody(upsertReportScheduleSchema), controller.upsertReportScheduleHandler);
reportScheduleRoutes.post("/report-schedule/send-now", canWrite, controller.sendReportScheduleNowHandler);
