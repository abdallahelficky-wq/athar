import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createPosSaleSchema, addPosFavoriteItemSchema } from "./pos.schemas";
import {
  createPosSaleHandler,
  quickAccessItemsHandler,
  listFavoritesHandler,
  addFavoriteHandler,
  removeFavoriteHandler,
} from "./pos.controller";

export const posRoutes = Router();
posRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canSell = requireRole("admin", "finance_manager", "accountant");

posRoutes.get("/quick-items", quickAccessItemsHandler);
posRoutes.get("/favorites", canSell, listFavoritesHandler);
posRoutes.post("/favorites", canSell, validateBody(addPosFavoriteItemSchema), addFavoriteHandler);
posRoutes.delete("/favorites/:warehouseId/:itemId", canSell, removeFavoriteHandler);
posRoutes.post("/sales", canSell, validateBody(createPosSaleSchema), createPosSaleHandler);
