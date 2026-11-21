import { Router } from "express";
import { requirePositionAction } from "../../middleware/positionMatrix";
import { authenticate, enforceCompanyScope, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { computeSchema, postSchema, settingsSchema, treatmentSchema } from "./zakat.schemas";
import * as c from "./zakat.controller";

/**
 * الزكاة (zakat.service.ts): read للاحتساب والعرض، create لحفظ إقرار وترحيل قيده، edit لإعدادات الطريقة ونسبة الملكية
 * وتصنيف الحسابات، delete لحذف إقرار بلا قيد.
 */
export const zakatRoutes = Router();
zakatRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

// الاحتساب قراءة صِرفة: GET، والتسويات في معامل adjustments (JSON) — يعمل حتى في وضع «عرض فقط»
zakatRoutes.get("/compute", requirePositionAction("zakat", "read"), c.computeHandler);
zakatRoutes.put("/settings", requirePositionAction("zakat", "edit"), validateBody(settingsSchema), c.settingsHandler);
zakatRoutes.put("/accounts/:accountId/treatment", requirePositionAction("zakat", "edit"), validateBody(treatmentSchema), c.treatmentHandler);
zakatRoutes.get("/declarations", requirePositionAction("zakat", "read"), c.listHandler);
zakatRoutes.post("/declarations", requirePositionAction("zakat", "create"), validateBody(computeSchema), c.saveHandler);
zakatRoutes.get("/declarations/:id", requirePositionAction("zakat", "read"), c.getHandler);
zakatRoutes.post("/declarations/:id/post", requirePositionAction("zakat", "create"), validateBody(postSchema), c.postHandler);
zakatRoutes.delete("/declarations/:id", requirePositionAction("zakat", "delete"), c.deleteHandler);

