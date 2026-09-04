import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createPurchaseInvoiceSchema, updatePurchaseInvoiceSchema, unpostSchema } from "./purchaseInvoices.schemas";
import { listHandler, getHandler, createHandler, updateHandler, deleteHandler, postHandler, unpostHandler } from "./purchaseInvoices.controller";

export const purchaseInvoiceRoutes = Router();
purchaseInvoiceRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");

purchaseInvoiceRoutes.get("/", listHandler);
purchaseInvoiceRoutes.get("/:id", getHandler);
purchaseInvoiceRoutes.post("/", canWrite, validateBody(createPurchaseInvoiceSchema), createHandler);
purchaseInvoiceRoutes.patch("/:id", canWrite, validateBody(updatePurchaseInvoiceSchema), updateHandler);
purchaseInvoiceRoutes.delete("/:id", canWrite, deleteHandler);
purchaseInvoiceRoutes.post("/:id/post", canWrite, postHandler);
purchaseInvoiceRoutes.post("/:id/unpost", canWrite, validateBody(unpostSchema), unpostHandler);
