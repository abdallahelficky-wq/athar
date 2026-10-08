import { requirePositionAction, requirePositionPosting } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly, requirePermission } from "../../middleware/auth";
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
  reissueZatcaHandler,
  zatcaHistoryHandler,
  zatcaAttemptXmlHandler,
  completeZatcaPostingHandler,
  zatcaBacklogHandler,
  zatcaChainGapsHandler,
  emailBacklogHandler,
  resendEmailHandler,
  searchHandler,
  downloadPdfHandler,
} from "./salesInvoices.controller";

export const salesInvoiceRoutes = Router();
salesInvoiceRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");
// فك ترحيل/إزالة مستند مرحّل (يحذف قيده) يتطلب صلاحية "فك الترحيل" على منصب المستخدم نفسها التي
// يتطلبها فك ترحيل قيد يومية مباشرة — لا الدور وحده. المالك وsuper_admin معفيان كما في كل صلاحية.
const canUnpost = requirePermission("accounts", "unpost");

salesInvoiceRoutes.get("/", requirePositionAction("salesInvoices", "read"), listHandler);
// قائمة قابلة للبحث/الفلترة/الترقيم من جانب الخادم — منفصلة عن "/" أعلاه عمداً (راجع تعليق
// searchHandler)، ويجب أن تُسجَّل قبل GET "/:id" وإلا التقطها Express كمعرّف فاتورة حرفي "search".
salesInvoiceRoutes.get("/search", requirePositionAction("salesInvoices", "read"), searchHandler);
// يجب أن يُسجَّلا قبل GET "/:id" وإلا التقطهما Express كمعرّف فاتورة حرفي "zatca-backlog"/"zatca-chain-gaps".
salesInvoiceRoutes.get("/zatca-backlog", requirePositionAction("salesInvoices", "read"), canWrite, zatcaBacklogHandler);
// نفس صلاحية zatca-backlog عمداً — راجع recordZatcaChainGap في salesInvoices.service.ts: يجب أن
// تكون فجوة سلسلة ICV/PIH مرئية لنفس من يتابع فواتير زاتكا المتأخرة، لا مدفونة في سجلات الخادم فقط.
salesInvoiceRoutes.get("/zatca-chain-gaps", requirePositionAction("salesInvoices", "read"), canWrite, zatcaChainGapsHandler);
// فواتير مرحّلة لم يُرسَل بريدها بنجاح بعد — راجع listInvoicesWithoutSuccessfulEmail. بلا إعادة
// إرسال تلقائية إطلاقاً؛ resend-email أدناه دائماً طلب صريح من مستخدم حقيقي.
salesInvoiceRoutes.get("/email-backlog", requirePositionAction("salesInvoices", "read"), canWrite, emailBacklogHandler);
salesInvoiceRoutes.get("/:id", requirePositionAction("salesInvoices", "read"), getHandler);
salesInvoiceRoutes.get("/:id/pdf", requirePositionAction("salesInvoices", "read"), downloadPdfHandler);
salesInvoiceRoutes.post("/", requirePositionAction("salesInvoices", "create"), requirePositionPosting("salesInvoices", true), canWrite, validateBody(createSalesInvoiceSchema), createHandler);
salesInvoiceRoutes.patch("/:id", requirePositionAction("salesInvoices", "edit"), canWrite, validateBody(updateSalesInvoiceSchema), updateHandler);
salesInvoiceRoutes.delete("/:id", requirePositionAction("salesInvoices", "delete"), canWrite, deleteHandler);
salesInvoiceRoutes.post("/:id/post", requirePositionAction("salesInvoices", "approve"), canWrite, postHandler);
salesInvoiceRoutes.post("/:id/unpost", requirePositionAction("salesInvoices", "approve"), canWrite, canUnpost, validateBody(unpostSchema), unpostHandler);
salesInvoiceRoutes.post("/:id/send-email", requirePositionAction("salesInvoices", "edit"), canWrite, validateBody(sendEmailSchema), sendEmailHandler);
salesInvoiceRoutes.post("/:id/resend-email", requirePositionAction("salesInvoices", "edit"), canWrite, validateBody(sendEmailSchema), resendEmailHandler);
salesInvoiceRoutes.post("/:id/resend-zatca", requirePositionAction("salesInvoices", "approve"), canWrite, resendZatcaHandler);
salesInvoiceRoutes.post("/:id/retry-zatca-submission", requirePositionAction("salesInvoices", "approve"), canWrite, retryZatcaSubmissionHandler);
salesInvoiceRoutes.post("/:id/reissue-zatca", requirePositionAction("salesInvoices", "approve"), canWrite, reissueZatcaHandler);
salesInvoiceRoutes.get("/:id/zatca-history", requirePositionAction("salesInvoices", "read"), zatcaHistoryHandler);
salesInvoiceRoutes.get("/:id/zatca-attempts/:attemptId/xml", requirePositionAction("salesInvoices", "read"), zatcaAttemptXmlHandler);
salesInvoiceRoutes.post("/:id/complete-zatca-posting", requirePositionAction("salesInvoices", "approve"), canWrite, completeZatcaPostingHandler);
