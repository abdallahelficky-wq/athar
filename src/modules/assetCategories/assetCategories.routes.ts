import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createAssetCategorySchema, updateAssetCategorySchema } from "./assetCategories.schemas";
import { listHandler, createHandler, updateHandler, removeHandler } from "./assetCategories.controller";

export const assetCategoryRoutes = Router();
assetCategoryRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");

assetCategoryRoutes.get("/", requirePositionAction("assetCategories", "read"), listHandler);
assetCategoryRoutes.post("/", requirePositionAction("assetCategories", "create"), canWrite, validateBody(createAssetCategorySchema), createHandler);
assetCategoryRoutes.patch("/:id", requirePositionAction("assetCategories", "edit"), canWrite, validateBody(updateAssetCategorySchema), updateHandler);
assetCategoryRoutes.delete("/:id", requirePositionAction("assetCategories", "delete"), canWrite, removeHandler);
