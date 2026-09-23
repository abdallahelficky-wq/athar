import { RequestHandler } from "express";
import * as service from "./salesDebitNotes.service";
import { prisma } from "../../lib/prisma";
import { assertRecordCompanyScope } from "../../middleware/auth";

export const listHandler: RequestHandler = async (req, res) => {
  const { companyId, customerId } = req.query;
  const debitNotes = await service.listSalesDebitNotes(req.auth!.tenantId, {
    companyId: typeof companyId === "string" ? companyId : undefined,
    customerId: typeof customerId === "string" ? customerId : undefined,
  });
  res.json(debitNotes);
};

export const createHandler: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createSalesDebitNote(req.auth!.tenantId, req.auth!.sub, req.body));
};

export const deleteHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesDebitNote, req.params.id);
  await service.deleteSalesDebitNote(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};

export const postHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesDebitNote, req.params.id);
  res.json(await service.postSalesDebitNote(req.auth!.tenantId, req.auth!.sub, req.params.id));
};

export const unpostHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesDebitNote, req.params.id);
  res.json(await service.unpostSalesDebitNote(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.pin));
};

// إعادة محاولة إشعار مدين عالق بحالة pending_submission — بنفس UUID/ICV/رقم الإشعار المحجوزة أصلاً.
export const retryZatcaSubmissionHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesDebitNote, req.params.id);
  res.json(await service.retryPendingZatcaSubmission(req.auth!.tenantId, req.auth!.sub, req.params.id));
};

// إكمال الترحيل المحلي (القيد فقط) لإشعار مدين استلم ردّاً من زاتكا بالفعل لكن المرحلة المحلية فشلت.
export const completeZatcaPostingHandler: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.salesDebitNote, req.params.id);
  res.json(await service.completeZatcaAcceptedPosting(req.auth!.tenantId, req.auth!.sub, req.params.id));
};
