import { Router } from "express";
import { requirePositionAction } from "../../middleware/positionMatrix";
import { authenticate, enforceCompanyScope, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { chequeActionSchema, chequeSettingsSchema, createChequeSchema } from "./cheques.schemas";
import * as c from "./cheques.controller";

/** الشيكات (cheques.service.ts): read للعرض، create للتسجيل، edit للتحصيل/الصرف/الارتداد/الإلغاء والإعدادات، delete للتراجع. */
export const chequeRoutes = Router();
chequeRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

chequeRoutes.get("/settings", requirePositionAction("cheques", "read"), c.getSettingsHandler);
chequeRoutes.put("/settings", requirePositionAction("cheques", "edit"), validateBody(chequeSettingsSchema), c.settingsHandler);
chequeRoutes.get("/", requirePositionAction("cheques", "read"), c.listHandler);
chequeRoutes.post("/", requirePositionAction("cheques", "create"), validateBody(createChequeSchema), c.createHandler);
chequeRoutes.get("/:id", requirePositionAction("cheques", "read"), c.getHandler);
chequeRoutes.post("/:id/clear", requirePositionAction("cheques", "edit"), validateBody(chequeActionSchema), c.actionHandler("clear"));
chequeRoutes.post("/:id/bounce", requirePositionAction("cheques", "edit"), validateBody(chequeActionSchema), c.actionHandler("bounce"));
chequeRoutes.post("/:id/cancel", requirePositionAction("cheques", "edit"), validateBody(chequeActionSchema), c.actionHandler("cancel"));
chequeRoutes.post("/:id/undo", requirePositionAction("cheques", "delete"), c.undoHandler);
