import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createSalesInvoiceSchema, updateSalesInvoiceSchema, unpostSchema, sendEmailSchema } from "./salesInvoices.schemas";
import {
  listHandler,
  getHandler,
  createHandler,
  updateHandler,
  deleteHandler,
  postHandler,
  unpostHandler,
  sendEmailHandler,
  resendZatcaHandler,
  retryZatcaSubmissionHandler,
  completeZatcaPostingHandler,
  zatcaBacklogHandler,
  zatcaChainGapsHandler,
  emailBacklogHandler,
  resendEmailHandler,
} from "./salesInvoices.controller";

export const salesInvoiceRoutes = Router();
salesInvoiceRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");

salesInvoiceRoutes.get("/", listHandler);
// يجب أن يُسجَّلا قبل GET "/:id" وإلا التقطهما Express كمعرّف فاتورة حرفي "zatca-backlog"/"zatca-chain-gaps".
salesInvoiceRoutes.get("/zatca-backlog", canWrite, zatcaBacklogHandler);
// نفس صلاحية zatca-backlog عمداً — راجع recordZatcaChainGap في salesInvoices.service.ts: يجب أن
// تكون فجوة سلسلة ICV/PIH مرئية لنفس من يتابع فواتير زاتكا المتأخرة، لا مدفونة في سجلات الخادم فقط.
salesInvoiceRoutes.get("/zatca-chain-gaps", canWrite, zatcaChainGapsHandler);
// فواتير مرحّلة لم يُرسَل بريدها بنجاح بعد — راجع listInvoicesWithoutSuccessfulEmail. بلا إعادة
// إرسال تلقائية إطلاقاً؛ resend-email أدناه دائماً طلب صريح من مستخدم حقيقي.
salesInvoiceRoutes.get("/email-backlog", canWrite, emailBacklogHandler);
salesInvoiceRoutes.get("/:id", getHandler);
salesInvoiceRoutes.post("/", canWrite, validateBody(createSalesInvoiceSchema), createHandler);
salesInvoiceRoutes.patch("/:id", canWrite, validateBody(updateSalesInvoiceSchema), updateHandler);
salesInvoiceRoutes.delete("/:id", canWrite, deleteHandler);
salesInvoiceRoutes.post("/:id/post", canWrite, postHandler);
salesInvoiceRoutes.post("/:id/unpost", canWrite, validateBody(unpostSchema), unpostHandler);
salesInvoiceRoutes.post("/:id/send-email", canWrite, validateBody(sendEmailSchema), sendEmailHandler);
salesInvoiceRoutes.post("/:id/resend-email", canWrite, validateBody(sendEmailSchema), resendEmailHandler);
salesInvoiceRoutes.post("/:id/resend-zatca", canWrite, resendZatcaHandler);
salesInvoiceRoutes.post("/:id/retry-zatca-submission", canWrite, retryZatcaSubmissionHandler);
salesInvoiceRoutes.post("/:id/complete-zatca-posting", canWrite, completeZatcaPostingHandler);
