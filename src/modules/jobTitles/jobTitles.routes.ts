import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createJobTitleSchema, updateJobTitleSchema } from "./jobTitles.schemas";
import { listJobTitlesHandler, createJobTitleHandler, renameJobTitleHandler, deleteJobTitleHandler } from "./jobTitles.controller";

// الوظائف بيانات أساسية لملفات الموظفين: قراءتها بصلاحية قراءة الموظفين، وتعديلها بنفس أدوار كتابة ملفات
// الموظفين (employees.routes.ts). على مستوى المستأجر لا شركة بعينها، فلا نطاق شركة هنا.
const canWrite = requireRole("admin", "finance_manager", "hr_manager");

export const jobTitleRoutes = Router();
jobTitleRoutes.use(authenticate, blockMutationsWhenReadOnly);

jobTitleRoutes.get("/", requirePositionAction("employees", "read"), listJobTitlesHandler);
jobTitleRoutes.post("/", requirePositionAction("employees", "create"), canWrite, validateBody(createJobTitleSchema), createJobTitleHandler);
jobTitleRoutes.patch("/:id", requirePositionAction("employees", "edit"), canWrite, validateBody(updateJobTitleSchema), renameJobTitleHandler);
jobTitleRoutes.delete("/:id", requirePositionAction("employees", "delete"), canWrite, deleteJobTitleHandler);
