import { Router } from "express";
import { requirePositionAction } from "../../middleware/positionMatrix";
import { authenticate, enforceCompanyScope, blockMutationsWhenReadOnly } from "../../middleware/auth";
import * as c from "./stationDashboard.controller";

/** لوحة إدارة محطات الوقود — قراءة فقط، بصلاحية قراءة تقارير الورديات (نفس أرقامها). */
export const stationDashboardRoutes = Router();
stationDashboardRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const read = requirePositionAction("stationShiftsReports", "read");
stationDashboardRoutes.get("/", read, c.overviewHandler);
stationDashboardRoutes.get("/stations/:costCenterId", read, c.stationHandler);
// الشاشة الحيّة لمحطة: حالة نقاط التعبئة والخزانات الآن من متحكمها — تُستطلَع كل بضع ثوانٍ
stationDashboardRoutes.get("/stations/:costCenterId/live", read, c.stationLiveHandler);
