import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createQuotationSchema, updateQuotationSchema } from "./quotations.schemas";
import { listHandler, createHandler, updateHandler, deleteHandler, convertHandler } from "./quotations.controller";

export const quotationRoutes = Router();
quotationRoutes.use(authenticate);

const canWrite = requireRole("admin", "finance_manager", "accountant");

quotationRoutes.get("/", listHandler);
quotationRoutes.post("/", canWrite, validateBody(createQuotationSchema), createHandler);
quotationRoutes.patch("/:id", canWrite, validateBody(updateQuotationSchema), updateHandler);
quotationRoutes.delete("/:id", canWrite, deleteHandler);
quotationRoutes.post("/:id/convert-to-invoice", canWrite, convertHandler);
