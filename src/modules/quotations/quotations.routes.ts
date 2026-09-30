import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createQuotationSchema, updateQuotationSchema } from "./quotations.schemas";
import { listHandler, createHandler, updateHandler, deleteHandler, convertHandler } from "./quotations.controller";

export const quotationRoutes = Router();
quotationRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");

quotationRoutes.get("/", requirePositionAction("quotations", "read"), listHandler);
quotationRoutes.post("/", requirePositionAction("quotations", "create"), canWrite, validateBody(createQuotationSchema), createHandler);
quotationRoutes.patch("/:id", requirePositionAction("quotations", "edit"), canWrite, validateBody(updateQuotationSchema), updateHandler);
quotationRoutes.delete("/:id", requirePositionAction("quotations", "delete"), canWrite, deleteHandler);
quotationRoutes.post("/:id/convert-to-invoice", requirePositionAction("quotations", "create"), requirePositionAction("salesInvoices", "create"), requirePositionAction("salesInvoices", "approve"), canWrite, convertHandler);
