import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createAssetCategorySchema, updateAssetCategorySchema } from "./assetCategories.schemas";
import { listHandler, createHandler, updateHandler, removeHandler } from "./assetCategories.controller";

export const assetCategoryRoutes = Router();
assetCategoryRoutes.use(authenticate, enforceCompanyScope);

const canWrite = requireRole("admin", "finance_manager", "accountant");

assetCategoryRoutes.get("/", listHandler);
assetCategoryRoutes.post("/", canWrite, validateBody(createAssetCategorySchema), createHandler);
assetCategoryRoutes.patch("/:id", canWrite, validateBody(updateAssetCategorySchema), updateHandler);
assetCategoryRoutes.delete("/:id", canWrite, removeHandler);
