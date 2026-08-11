import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createPosSaleSchema } from "./pos.schemas";
import { createPosSaleHandler, quickAccessItemsHandler } from "./pos.controller";

export const posRoutes = Router();
posRoutes.use(authenticate);

const canSell = requireRole("admin", "finance_manager", "accountant");

posRoutes.get("/quick-items", quickAccessItemsHandler);
posRoutes.post("/sales", canSell, validateBody(createPosSaleSchema), createPosSaleHandler);
