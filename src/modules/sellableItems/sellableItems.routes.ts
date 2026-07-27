import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createSellableItemSchema, updateSellableItemSchema } from "./sellableItems.schemas";
import { listSellableItems, createSellableItem, updateSellableItem, deleteSellableItem } from "./sellableItems.controller";

export const sellableItemRoutes = Router();
sellableItemRoutes.use(authenticate);

const canWrite = requireRole("admin", "finance_manager", "accountant");

sellableItemRoutes.get("/", listSellableItems);
sellableItemRoutes.post("/", canWrite, validateBody(createSellableItemSchema), createSellableItem);
sellableItemRoutes.patch("/:id", canWrite, validateBody(updateSellableItemSchema), updateSellableItem);
sellableItemRoutes.delete("/:id", canWrite, deleteSellableItem);
