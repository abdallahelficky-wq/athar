import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createSalesInvoiceSchema, updateSalesInvoiceSchema, unpostSchema, sendEmailSchema } from "./salesInvoices.schemas";
import { listHandler, getHandler, createHandler, updateHandler, deleteHandler, postHandler, unpostHandler, sendEmailHandler, resendZatcaHandler, zatcaBacklogHandler } from "./salesInvoices.controller";

export const salesInvoiceRoutes = Router();
salesInvoiceRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");

salesInvoiceRoutes.get("/", listHandler);
// يجب أن يُسجَّل قبل GET "/:id" وإلا التقطها Express كمعرّف فاتورة حرفي "zatca-backlog".
salesInvoiceRoutes.get("/zatca-backlog", canWrite, zatcaBacklogHandler);
salesInvoiceRoutes.get("/:id", getHandler);
salesInvoiceRoutes.post("/", canWrite, validateBody(createSalesInvoiceSchema), createHandler);
salesInvoiceRoutes.patch("/:id", canWrite, validateBody(updateSalesInvoiceSchema), updateHandler);
salesInvoiceRoutes.delete("/:id", canWrite, deleteHandler);
salesInvoiceRoutes.post("/:id/post", canWrite, postHandler);
salesInvoiceRoutes.post("/:id/unpost", canWrite, validateBody(unpostSchema), unpostHandler);
salesInvoiceRoutes.post("/:id/send-email", canWrite, validateBody(sendEmailSchema), sendEmailHandler);
salesInvoiceRoutes.post("/:id/resend-zatca", canWrite, resendZatcaHandler);
