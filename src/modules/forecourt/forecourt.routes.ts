import { Router } from "express";
import { requirePositionAction } from "../../middleware/positionMatrix";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createControllerSchema, updateControllerSchema, setNozzleMapSchema } from "./forecourt.schemas";
import * as c from "./forecourt.controller";

/**
 * متحكمات المحطات — إدارة المستخدمين فقط (بصلاحيات إعداد المحطات). نقطة استقبال رسائل الجهاز نفسها غير موجودة بعد:
 * تُبنى بمصادقة الجهاز والتحقق من التوقيع بعد وصول مواصفة jsonPTS (docs/design/pts2-integration.md).
 */
export const forecourtRoutes = Router();
forecourtRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canManage = requireRole("admin", "finance_manager");

forecourtRoutes.get("/controllers", requirePositionAction("stationSetup", "read"), c.listControllersHandler);
forecourtRoutes.post("/controllers", requirePositionAction("stationSetup", "create"), canManage, validateBody(createControllerSchema), c.createControllerHandler);
forecourtRoutes.patch("/controllers/:id", requirePositionAction("stationSetup", "edit"), canManage, validateBody(updateControllerSchema), c.updateControllerHandler);
forecourtRoutes.put("/controllers/:id/nozzle-map", requirePositionAction("stationSetup", "edit"), canManage, validateBody(setNozzleMapSchema), c.setNozzleMapHandler);
forecourtRoutes.get("/transactions", requirePositionAction("stationSetup", "read"), c.listTransactionsHandler);
