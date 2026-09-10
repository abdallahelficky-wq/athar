import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createSalesReturnSchema, unpostSchema } from "./salesReturns.schemas";
import { listHandler, createHandler, deleteHandler, postHandler, unpostHandler } from "./salesReturns.controller";

export const salesReturnRoutes = Router();
salesReturnRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");

salesReturnRoutes.get("/", listHandler);
salesReturnRoutes.post("/", canWrite, validateBody(createSalesReturnSchema), createHandler);
salesReturnRoutes.delete("/:id", canWrite, deleteHandler);
salesReturnRoutes.post("/:id/post", canWrite, postHandler);
salesReturnRoutes.post("/:id/unpost", canWrite, validateBody(unpostSchema), unpostHandler);
