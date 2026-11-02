import { Router } from "express";
import { requirePositionAction } from "../../middleware/positionMatrix";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createTankSchema, updateTankSchema, setNozzleTankSchema, createReadingSchema, voidSchema, createDeliverySchema } from "./stationTanks.schemas";
import * as c from "./stationTanks.controller";

/**
 * الخزانات والتوريد — نفس صلاحيات إعداد المحطات: القراءة ضمن نطاق الشركة، والكتابة لـ admin/finance_manager.
 * الإلغاء (قراءة/توريد) بسبب إلزامي ولا حذف.
 */
export const stationTankRoutes = Router();
stationTankRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canManage = requireRole("admin", "finance_manager");
const read = requirePositionAction("stationSetup", "read");
const create = requirePositionAction("stationSetup", "create");
const edit = requirePositionAction("stationSetup", "edit");

stationTankRoutes.get("/tanks", read, c.listTanksHandler);
stationTankRoutes.post("/tanks", create, canManage, validateBody(createTankSchema), c.createTankHandler);
stationTankRoutes.patch("/tanks/:id", edit, canManage, validateBody(updateTankSchema), c.updateTankHandler);
stationTankRoutes.put("/nozzles/:id/tank", edit, canManage, validateBody(setNozzleTankSchema), c.setNozzleTankHandler);

stationTankRoutes.get("/readings", read, c.listReadingsHandler);
stationTankRoutes.post("/readings", create, canManage, validateBody(createReadingSchema), c.createReadingHandler);
stationTankRoutes.post("/readings/:id/void", edit, canManage, validateBody(voidSchema), c.voidReadingHandler);

stationTankRoutes.get("/deliveries", read, c.listDeliveriesHandler);
stationTankRoutes.post("/deliveries", create, canManage, validateBody(createDeliverySchema), c.createDeliveryHandler);
stationTankRoutes.post("/deliveries/:id/void", edit, canManage, validateBody(voidSchema), c.voidDeliveryHandler);

stationTankRoutes.get("/reconciliation", read, c.reconcileHandler);
