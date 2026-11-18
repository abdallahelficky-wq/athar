import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest } from "../../lib/httpError";
import { assertCompanyAccess } from "../../middleware/auth";
import * as service from "./leaseContracts.service";

const q = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);
type Req = Parameters<RequestHandler>[0];

function requireCompany(req: Req) {
  const companyId = q(req.query.companyId) ?? q(req.body?.companyId);
  if (!companyId) throw badRequest("الشركة مطلوبة");
  assertCompanyAccess(req.auth!, companyId);
  return companyId;
}

/** السجل المحمَّل بالمعرّف: يُتحقَّق من شركته نفسها (لا من طلب العميل) قبل أي تعديل عليه. الخدمة ترجع 404 لغير الموجود. */
async function scopeContract(req: Req, id: string) {
  const row = await prisma.leaseContract.findFirst({ where: { id, tenantId: req.auth!.tenantId }, select: { companyId: true } });
  if (row) assertCompanyAccess(req.auth!, row.companyId);
}
async function scopePayment(req: Req, id: string) {
  const row = await prisma.leasePayment.findFirst({ where: { id, tenantId: req.auth!.tenantId }, select: { companyId: true } });
  if (row) assertCompanyAccess(req.auth!, row.companyId);
}

// --- العقود ---

export const listLeaseContracts: RequestHandler = async (req, res) => {
  const companyId = q(req.query.companyId);
  if (companyId) assertCompanyAccess(req.auth!, companyId);
  res.json(await service.listLeaseContracts(req.auth!.tenantId, companyId));
};

export const createLeaseContract: RequestHandler = async (req, res) => {
  requireCompany(req);
  res.status(201).json(await service.createLeaseContract(req.auth!.tenantId, req.body));
};

export const updateLeaseContract: RequestHandler = async (req, res) => {
  await scopeContract(req, req.params.id);
  res.json(await service.updateLeaseContract(req.auth!.tenantId, req.params.id, req.body));
};

export const deleteLeaseContract: RequestHandler = async (req, res) => {
  await scopeContract(req, req.params.id);
  await service.deleteLeaseContract(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};

export const applyAccountsHandler: RequestHandler = async (req, res) => {
  requireCompany(req);
  res.json(await service.applyLeaseAccounts(req.auth!.tenantId, req.body));
};

export const importHandler: RequestHandler = async (req, res) => {
  const companyId = requireCompany(req);
  res.status(201).json(await service.importLeaseContracts(req.auth!.tenantId, req.auth!.sub, companyId, req.body.contracts));
};

// --- جدول الدفعات والتقويم ---

export const calendarHandler: RequestHandler = async (req, res) => {
  const companyId = requireCompany(req);
  const from = q(req.query.from);
  const to = q(req.query.to);
  if (!from || !to) throw badRequest("حدّد فترة التقويم (من، إلى)");
  res.json(await service.leaseCalendar(req.auth!.tenantId, companyId, { from, to }));
};

export const alertsHandler: RequestHandler = async (req, res) => {
  res.json(await service.leaseAlerts(req.auth!.tenantId, requireCompany(req)));
};

export const generateScheduleHandler: RequestHandler = async (req, res) => {
  await scopeContract(req, req.params.id);
  res.status(201).json(await service.generateLeaseSchedule(req.auth!.tenantId, req.params.id, req.body.until));
};

export const createPaymentHandler: RequestHandler = async (req, res) => {
  const { leaseContractId, ...input } = req.body;
  await scopeContract(req, leaseContractId);
  res.status(201).json(await service.createLeasePayment(req.auth!.tenantId, leaseContractId, input));
};

export const updatePaymentHandler: RequestHandler = async (req, res) => {
  await scopePayment(req, req.params.id);
  res.json(await service.updateLeasePayment(req.auth!.tenantId, req.params.id, req.body));
};

export const deletePaymentHandler: RequestHandler = async (req, res) => {
  await scopePayment(req, req.params.id);
  await service.deleteLeasePayment(req.auth!.tenantId, req.params.id);
  res.status(204).send();
};

export const confirmPaymentHandler: RequestHandler = async (req, res) => {
  await scopePayment(req, req.params.id);
  res.json(await service.confirmLeasePayment(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body));
};

export const reversePaymentHandler: RequestHandler = async (req, res) => {
  await scopePayment(req, req.params.id);
  res.json(await service.reverseLeasePayment(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body));
};

// --- الإطفاء الشهري ---

export const listAmortizationHandler: RequestHandler = async (req, res) => {
  res.json(await service.listLeaseAmortizationRuns(req.auth!.tenantId, requireCompany(req)));
};

export const previewAmortizationHandler: RequestHandler = async (req, res) => {
  const companyId = requireCompany(req);
  const month = q(req.query.month);
  if (!month) throw badRequest("حدّد شهر الإطفاء");
  res.json(await service.previewLeaseAmortization(req.auth!.tenantId, companyId, month));
};

export const postAmortizationHandler: RequestHandler = async (req, res) => {
  const companyId = requireCompany(req);
  res.status(201).json(await service.postLeaseAmortization(req.auth!.tenantId, req.auth!.sub, companyId, req.body.month));
};

export const removeAmortizationHandler: RequestHandler = async (req, res) => {
  const row = await prisma.leaseAmortizationRun.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId }, select: { companyId: true } });
  if (row) assertCompanyAccess(req.auth!, row.companyId);
  await service.removeLeaseAmortizationRun(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.pin);
  res.status(204).send();
};
