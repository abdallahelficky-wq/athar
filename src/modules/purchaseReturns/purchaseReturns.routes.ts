import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createPurchaseReturnSchema, unpostSchema } from "./purchaseReturns.schemas";
import { listHandler, createHandler, deleteHandler, postHandler, unpostHandler } from "./purchaseReturns.controller";

export const purchaseReturnRoutes = Router();
purchaseReturnRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");

purchaseReturnRoutes.get("/", listHandler);
purchaseReturnRoutes.post("/", canWrite, validateBody(createPurchaseReturnSchema), createHandler);
purchaseReturnRoutes.delete("/:id", canWrite, deleteHandler);
purchaseReturnRoutes.post("/:id/post", canWrite, postHandler);
purchaseReturnRoutes.post("/:id/unpost", canWrite, validateBody(unpostSchema), unpostHandler);
