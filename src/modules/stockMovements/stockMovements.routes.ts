import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createInOutSchema, createIssueSchema, createTransferSchema, removeSchema } from "./stockMovements.schemas";
import {
  listHandler,
  balanceHandler,
  itemCardHandler,
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
// يجب أن يُسجَّل قبل أي مسار عام لاحق بنمط "/:شيء" وإلا التقطه Express كمعرّف حرفي — لا تعارض حالياً
// (لا يوجد GET "/:id" عام في هذه الوحدة أصلاً)، لكن يبقى الترتيب الآمن المتّبع في كل موديول آخر.
stockMovementRoutes.get("/item-card/:itemId", itemCardHandler);
stockMovementRoutes.post("/in-out", canWrite, validateBody(createInOutSchema), createInOutHandler);
stockMovementRoutes.post("/issue", canWrite, validateBody(createIssueSchema), createIssueHandler);
stockMovementRoutes.post("/transfer", canWrite, validateBody(createTransferSchema), createTransferHandler);
stockMovementRoutes.delete("/:id", canWrite, validateBody(removeSchema), removeHandler);
