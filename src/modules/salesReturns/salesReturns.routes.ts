import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createSalesReturnSchema, updateSalesReturnSchema, unpostSchema, sendEmailSchema } from "./salesReturns.schemas";
import {
  listHandler,
  searchHandler,
  getHandler,
  createHandler,
  updateHandler,
  deleteHandler,
  postHandler,
  unpostHandler,
  sendEmailHandler,
  downloadPdfHandler,
  retryZatcaSubmissionHandler,
  completeZatcaPostingHandler,
} from "./salesReturns.controller";

export const salesReturnRoutes = Router();
salesReturnRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");

salesReturnRoutes.get("/", listHandler);
// يجب أن تُسجَّل قبل GET "/:id" وإلا التقطها Express كمعرّف مردود حرفي "search" — نفس تبرير
// ترتيب /sales-invoices/search بالضبط.
salesReturnRoutes.get("/search", searchHandler);
salesReturnRoutes.get("/:id", getHandler);
salesReturnRoutes.get("/:id/pdf", downloadPdfHandler);
salesReturnRoutes.post("/", canWrite, validateBody(createSalesReturnSchema), createHandler);
salesReturnRoutes.patch("/:id", canWrite, validateBody(updateSalesReturnSchema), updateHandler);
salesReturnRoutes.delete("/:id", canWrite, deleteHandler);
salesReturnRoutes.post("/:id/send-email", canWrite, validateBody(sendEmailSchema), sendEmailHandler);
salesReturnRoutes.post("/:id/post", canWrite, postHandler);
salesReturnRoutes.post("/:id/unpost", canWrite, validateBody(unpostSchema), unpostHandler);
salesReturnRoutes.post("/:id/retry-zatca-submission", canWrite, retryZatcaSubmissionHandler);
salesReturnRoutes.post("/:id/complete-zatca-posting", canWrite, completeZatcaPostingHandler);
