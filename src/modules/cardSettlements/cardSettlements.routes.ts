import { Router } from "express";
import { authenticate, enforceCompanyScope, requireActionPermission, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createSettlementSchema, reverseSettlementSchema } from "./cardSettlements.schemas";
import * as c from "./cardSettlements.controller";

/**
 * تسويات الشبكة وبطاقات الوقود — جزء من شاشة إدارة محطات الوقود. العرض بصلاحية مراجعة الورديات، والتسجيل والعكس بصلاحية
 * ترحيل الورديات (ينشئان قيوداً تُقفل ذمماً أنشأها ترحيل الورديات).
 */
export const cardSettlementRoutes = Router();
cardSettlementRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const reviewAccess = requireActionPermission("stationShifts", "review", "approve");
const postAccess = requireActionPermission("stationShifts", "post", "approve");

cardSettlementRoutes.get("/", reviewAccess, c.listHandler);
cardSettlementRoutes.get("/reconciliation", reviewAccess, c.reconciliationHandler);
cardSettlementRoutes.post("/", postAccess, validateBody(createSettlementSchema), c.createHandler);
cardSettlementRoutes.post("/:id/reverse", postAccess, validateBody(reverseSettlementSchema), c.reverseHandler);
