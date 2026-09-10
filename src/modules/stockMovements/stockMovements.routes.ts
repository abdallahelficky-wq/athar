import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createInOutSchema, createIssueSchema, createTransferSchema, removeSchema } from "./stockMovements.schemas";
import {
  listHandler,
  balanceHandler,
  createInOutHandler,
  createIssueHandler,
  createTransferHandler,
  removeHandler,
} from "./stockMovements.controller";

export const stockMovementRoutes = Router();
stockMovementRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");

stockMovementRoutes.get("/", listHandler);
stockMovementRoutes.get("/balance", balanceHandler);
stockMovementRoutes.post("/in-out", canWrite, validateBody(createInOutSchema), createInOutHandler);
stockMovementRoutes.post("/issue", canWrite, validateBody(createIssueSchema), createIssueHandler);
stockMovementRoutes.post("/transfer", canWrite, validateBody(createTransferSchema), createTransferHandler);
stockMovementRoutes.delete("/:id", canWrite, validateBody(removeSchema), removeHandler);
