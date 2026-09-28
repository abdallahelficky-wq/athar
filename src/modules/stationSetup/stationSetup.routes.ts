import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createPumpSchema, updateNozzleSchema, retirePumpSchema, createFuelPriceSchema } from "./stationSetup.schemas";
import { listStations, createPump, updateNozzle, retirePump, listFuelPrices, createFuelPrice, deleteFuelPrice } from "./stationSetup.controller";

/**
 * إعداد المحطات (المضخات والفوهات) وأسعار الوقود — نفس نمط مراكز التكلفة: القراءة لأي مستخدم ضمن
 * نطاق الشركة، والكتابة لـ admin/finance_manager (مالك المستأجر admin بطبيعته).
 */
export const stationSetupRoutes = Router();
stationSetupRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canManage = requireRole("admin", "finance_manager");

stationSetupRoutes.get("/stations", listStations);
stationSetupRoutes.post("/pumps", canManage, validateBody(createPumpSchema), createPump);
stationSetupRoutes.post("/pumps/retire", canManage, validateBody(retirePumpSchema), retirePump);
stationSetupRoutes.patch("/nozzles/:id", canManage, validateBody(updateNozzleSchema), updateNozzle);

stationSetupRoutes.get("/fuel-prices", listFuelPrices);
stationSetupRoutes.post("/fuel-prices", canManage, validateBody(createFuelPriceSchema), createFuelPrice);
stationSetupRoutes.delete("/fuel-prices/:id", canManage, deleteFuelPrice);
