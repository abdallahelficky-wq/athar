import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createFixedAssetSchema, updateFixedAssetSchema, disposeFixedAssetSchema, removeSchema } from "./fixedAssets.schemas";
import { listHandler, createHandler, updateHandler, removeHandler, disposeHandler, summaryHandler } from "./fixedAssets.controller";

export const fixedAssetRoutes = Router();
fixedAssetRoutes.use(authenticate, enforceCompanyScope);

const canWrite = requireRole("admin", "finance_manager", "accountant");

fixedAssetRoutes.get("/reports/summary", summaryHandler);
fixedAssetRoutes.get("/", listHandler);
fixedAssetRoutes.post("/", canWrite, validateBody(createFixedAssetSchema), createHandler);
fixedAssetRoutes.patch("/:id", canWrite, validateBody(updateFixedAssetSchema), updateHandler);
fixedAssetRoutes.delete("/:id", canWrite, validateBody(removeSchema), removeHandler);
fixedAssetRoutes.post("/:id/dispose", canWrite, validateBody(disposeFixedAssetSchema), disposeHandler);
