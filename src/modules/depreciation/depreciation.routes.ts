import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createDepreciationRunSchema, removeSchema } from "./depreciation.schemas";
import { listHandler, previewHandler, createHandler, removeHandler } from "./depreciation.controller";

export const depreciationRunRoutes = Router();
depreciationRunRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");

depreciationRunRoutes.get("/", listHandler);
depreciationRunRoutes.get("/preview", previewHandler);
depreciationRunRoutes.post("/", canWrite, validateBody(createDepreciationRunSchema), createHandler);
depreciationRunRoutes.delete("/:id", canWrite, validateBody(removeSchema), removeHandler);
