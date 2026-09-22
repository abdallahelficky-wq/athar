import { RequestHandler } from "express";
import * as service from "./salesInvoices.service";
import { sendInvoiceByEmail, listInvoicesWithoutSuccessfulEmail, resendInvoiceEmail } from "./salesInvoiceEmail.service";
import { searchSalesInvoices } from "./salesInvoicesSearch.service";
import { searchSalesInvoicesQuerySchema } from "./salesInvoices.schemas";
import { prisma } from "../../lib/prisma";
import { badRequest } from "../../lib/httpError";
import { assertRecordCompanyScope } from "../../middleware/auth";

export const listHandler: RequestHandler = async (req, res) => {
  const { companyId, customerId } = req.query;
  const invoices = await service.listSalesInvoices(req.auth!.tenantId, {
    companyId: typeof companyId === "string" ? companyId : undefined,
    customerId: typeof customerId === "string" ? customerId : undefined,
  });
  res.json(invoices);
};

// نقطة نهاية مستقلة تماماً عن listHandler أعلاه (لا تُغيّره ولا تستبدله) — عدّة استدعاءات موجودة
// فعلاً (QuickSearch، شاشة المردودات) تعتمد على أن /sales-invoices تُعيد كل الفواتير كمصفوفة خام
// بلا ترقيم؛ تغيير ذلك يكسرها. هذه الشاشة الجديدة (قائمة فواتير المبيعات بالبحث/الفلترة/الترقيم)
// تستخدم مساراً منفصلاً بنتيجة مختلفة الشكل عمداً ({items, totalCount, summary, ...}).
export const searchHandler: RequestHandler = async (req, res) => {
  const parsed = searchSalesInvoicesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest("معايير البحث غير صالحة", parsed.error.flatten());
  }
  res.json(await searchSalesInvoices(req.auth!.tenantId, parsed.data));
};

export const zatcaBacklogHandler: RequestHandler = async (req, res) => {
  const { companyId } = req.query;
  const backlog = await service.listZatcaBacklog(req.auth!.tenantId, {
    companyId: typeof companyId === "string" ? companyId : undefined,
  });
  res.json(backlog);
};

export const zatcaChainGapsHandler: RequestHandler = async (req, res) => {
  res.json(await service.listZatcaChainGaps(req.auth!.tenantId));
};

export const getHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesInvoice, req.params.id);
  res.json(await service.getSalesInvoice(req.auth!.tenantId, req.params.id));
};

export const createHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createSalesInvoice(req.auth!.tenantId, req.auth!.sub, req.body));
};

export const updateHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesInvoice, req.params.id);
  res.json(await service.updateSalesInvoice(req.auth!.tenantId, req.params.id, req.body));
};

export const deleteHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesInvoice, req.params.id);
  await service.deleteSalesInvoice(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};

export const postHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesInvoice, req.params.id);
  res.json(await service.postSalesInvoice(req.auth!.tenantId, req.auth!.sub, req.params.id));
};

export const unpostHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesInvoice, req.params.id);
  res.json(await service.unpostSalesInvoice(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.pin));
};

export const sendEmailHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesInvoice, req.params.id);
  const result = await sendInvoiceByEmail(req.auth!.tenantId, req.params.id, {
    method: "manual",
    overrideEmail: req.body?.email || undefined,
  });
  res.json(result);
};

// قائمة متابعة يدوية: فواتير مرحّلة لم يُرسَل بريدها بنجاح ولو مرة (لم تُحاوَل إطلاقاً، أو حاولت
// وفشلت — راجع listInvoicesWithoutSuccessfulEmail). بلا أي إعادة إرسال تلقائية هنا.
export const emailBacklogHandler: RequestHandler = async (req, res) => {
  const { companyId } = req.query;
  const backlog = await listInvoicesWithoutSuccessfulEmail(req.auth!.tenantId, {
    companyId: typeof companyId === "string" ? companyId : undefined,
  });
  res.json(backlog);
};

// إعادة إرسال يدوية صريحة لفاتورة من قائمة email-backlog أعلاه — نفس منطق sendEmailHandler بالضبط
// (method: "manual")، بمسار مستقل واضح الغرض لهذه الشاشة تحديداً.
export const resendEmailHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesInvoice, req.params.id);
  const result = await resendInvoiceEmail(req.auth!.tenantId, req.params.id, req.body?.email || undefined);
  res.json(result);
};

export const resendZatcaHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesInvoice, req.params.id);
  res.json(await service.resendInvoiceToZatca(req.auth!.tenantId, req.params.id));
};

// إعادة محاولة فاتورة عالقة بحالة pending_submission (لم يصلها ردّ نهائي من زاتكا بعد) — بنفس
// UUID/ICV/رقم الفاتورة المحجوزة أصلاً، بلا حجز أي شيء جديد. راجع retryPendingZatcaSubmission.
export const retryZatcaSubmissionHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesInvoice, req.params.id);
  res.json(await service.retryPendingZatcaSubmission(req.auth!.tenantId, req.auth!.sub, req.params.id));
};

// إكمال الترحيل المحلي (قيد + مخزون + عمولات) لفاتورة استلمت ردّاً من زاتكا بالفعل لكن المرحلة
// المحلية اللاحقة فشلت — بلا أي اتصال جديد بزاتكا إطلاقاً. راجع completeZatcaAcceptedPosting.
export const completeZatcaPostingHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesInvoice, req.params.id);
  res.json(await service.completeZatcaAcceptedPosting(req.auth!.tenantId, req.auth!.sub, req.params.id));
};
