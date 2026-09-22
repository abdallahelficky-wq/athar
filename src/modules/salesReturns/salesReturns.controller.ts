import { RequestHandler } from "express";
import * as service from "./salesReturns.service";
import { getSalesReturnPdf, sendSalesReturnByEmail } from "./salesReturnEmail.service";
import { searchSalesReturns } from "./salesReturnsSearch.service";
import { searchSalesReturnsQuerySchema } from "./salesReturns.schemas";
import { prisma } from "../../lib/prisma";
import { badRequest } from "../../lib/httpError";
import { assertRecordCompanyScope } from "../../middleware/auth";

export const listHandler: RequestHandler = async (req, res) => {
  const { companyId, customerId } = req.query;
  const returns = await service.listSalesReturns(req.auth!.tenantId, {
    companyId: typeof companyId === "string" ? companyId : undefined,
    customerId: typeof customerId === "string" ? customerId : undefined,
  });
  res.json(returns);
};

// قائمة قابلة للبحث/الفلترة/الترقيم من جانب الخادم — منفصلة عن "/" أعلاه عمداً، بنفس تبرير
// searchHandler في salesInvoices.controller.ts بالضبط: "/" الخام مستخدَم فعلاً (شاشة إصدار إشعار
// دائن من فاتورة، QuickSearch) ولا يجوز تغيير شكل نتيجته.
export const searchHandler: RequestHandler = async (req, res) => {
  const parsed = searchSalesReturnsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest("معايير البحث غير صالحة", parsed.error.flatten());
  }
  res.json(await searchSalesReturns(req.auth!.tenantId, parsed.data));
};

export const getHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesReturn, req.params.id);
  res.json(await service.getSalesReturn(req.auth!.tenantId, req.params.id));
};

export const createHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createSalesReturn(req.auth!.tenantId, req.auth!.sub, req.body));
};

// تعديل مسودة إشعار دائن لم تُرحَّل بعد — راجع updateSalesReturn: يرفض المرحّل من الخادم نفسه
// (badRequest)، ولا يُغيّر أي حقل زاتكا/قيد محاسبي إطلاقاً.
export const updateHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesReturn, req.params.id);
  res.json(await service.updateSalesReturn(req.auth!.tenantId, req.params.id, req.body));
};

// تحميل PDF إشعار الدائن — نفس نمط downloadPdfHandler في salesInvoices.controller.ts بالضبط.
export const downloadPdfHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesReturn, req.params.id);
  const { buffer, fileName } = await getSalesReturnPdf(req.auth!.tenantId, req.params.id);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
  res.send(buffer);
};

export const sendEmailHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesReturn, req.params.id);
  const result = await sendSalesReturnByEmail(req.auth!.tenantId, req.params.id, req.body?.email || undefined);
  res.json(result);
};

export const deleteHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesReturn, req.params.id);
  await service.deleteSalesReturn(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};

export const postHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesReturn, req.params.id);
  res.json(await service.postSalesReturn(req.auth!.tenantId, req.auth!.sub, req.params.id));
};

export const unpostHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesReturn, req.params.id);
  res.json(await service.unpostSalesReturn(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.pin));
};

// إعادة محاولة مردود عالق بحالة pending_submission — بنفس UUID/ICV/رقم المردود المحجوزة أصلاً.
export const retryZatcaSubmissionHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesReturn, req.params.id);
  res.json(await service.retryPendingZatcaSubmission(req.auth!.tenantId, req.auth!.sub, req.params.id));
};

// إكمال الترحيل المحلي (القيد فقط) لمردود استلم ردّاً من زاتكا بالفعل لكن المرحلة المحلية فشلت.
export const completeZatcaPostingHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesReturn, req.params.id);
  res.json(await service.completeZatcaAcceptedPosting(req.auth!.tenantId, req.auth!.sub, req.params.id));
};
