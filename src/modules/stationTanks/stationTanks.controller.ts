import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest } from "../../lib/httpError";
import { assertCompanyAccess } from "../../middleware/auth";
import * as service from "./stationTanks.service";
import * as variance from "./tankVariancePosting.service";

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const q = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);

function requireCompany(req: Parameters<RequestHandler>[0]) {
  const companyId = q(req.query.companyId) ?? q(req.body?.companyId);
  if (!companyId) throw badRequest("الشركة مطلوبة");
  assertCompanyAccess(req.auth!, companyId);
  return companyId;
}

/** السجلات المحمَّلة بالمعرّف: يُتحقَّق من شركة السجل نفسه قبل أي إجراء (لا من طلب العميل). */
async function assertRecordCompany(req: Parameters<RequestHandler>[0], model: "stationTank" | "stationNozzle" | "tankReading" | "fuelDelivery" | "tankVariancePosting", id: string) {
  const tenantId = req.auth!.tenantId;
  const row = await (prisma[model] as unknown as { findFirst: (a: unknown) => Promise<{ companyId: string } | null> }).findFirst({ where: { id, tenantId }, select: { companyId: true } });
  if (row) assertCompanyAccess(req.auth!, row.companyId);
}

const range = (req: Parameters<RequestHandler>[0]) => {
  const from = q(req.query.from);
  const to = q(req.query.to);
  if ((from && !dateOnly.test(from)) || (to && !dateOnly.test(to))) throw badRequest("صيغة التاريخ يجب أن تكون YYYY-MM-DD");
  return { from, to };
};

export const listTanksHandler: RequestHandler = async (req, res) => {
  res.json(await service.listTanks(req.auth!.tenantId, requireCompany(req)));
};

export const createTankHandler: RequestHandler = async (req, res) => {
  requireCompany(req);
  res.status(201).json(await service.createTank(req.auth!.tenantId, req.body));
};

export const updateTankHandler: RequestHandler = async (req, res) => {
  await assertRecordCompany(req, "stationTank", req.params.id);
  res.json(await service.updateTank(req.auth!.tenantId, req.params.id, req.body));
};

export const setNozzleTankHandler: RequestHandler = async (req, res) => {
  await assertRecordCompany(req, "stationNozzle", req.params.id);
  res.json(await service.setNozzleTank(req.auth!.tenantId, req.params.id, req.body.tankId));
};

export const listReadingsHandler: RequestHandler = async (req, res) => {
  res.json(await service.listReadings(req.auth!.tenantId, requireCompany(req), { tankId: q(req.query.tankId), ...range(req) }));
};

export const createReadingHandler: RequestHandler = async (req, res) => {
  await assertRecordCompany(req, "stationTank", req.body.tankId);
  res.status(201).json(await service.createManualReading(req.auth!.tenantId, req.auth!.sub, req.body));
};

export const voidReadingHandler: RequestHandler = async (req, res) => {
  await assertRecordCompany(req, "tankReading", req.params.id);
  res.json(await service.voidReading(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.reason));
};

export const listDeliveriesHandler: RequestHandler = async (req, res) => {
  res.json(await service.listDeliveries(req.auth!.tenantId, requireCompany(req), range(req)));
};

export const createDeliveryHandler: RequestHandler = async (req, res) => {
  requireCompany(req);
  res.status(201).json(await service.createDelivery(req.auth!.tenantId, req.auth!.sub, req.body));
};

export const voidDeliveryHandler: RequestHandler = async (req, res) => {
  await assertRecordCompany(req, "fuelDelivery", req.params.id);
  res.json(await service.voidDelivery(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.reason));
};

export const reconcileHandler: RequestHandler = async (req, res) => {
  const companyId = requireCompany(req);
  const { from, to } = range(req);
  if (!from || !to) throw badRequest("حدّد فترة المطابقة (من، إلى)");
  res.json(await service.reconcile(req.auth!.tenantId, companyId, { from, to, costCenterId: q(req.query.costCenterId) }));
};

export const listVariancePostingsHandler: RequestHandler = async (req, res) => {
  res.json(await variance.listTankVariancePostings(req.auth!.tenantId, requireCompany(req), range(req)));
};

export const postVarianceHandler: RequestHandler = async (req, res) => {
  requireCompany(req);
  if (req.body.from > req.body.to) throw badRequest("تاريخ البداية بعد تاريخ النهاية");
  res.status(201).json(await variance.postTankVariance(req.auth!.tenantId, req.auth!.sub, req.body));
};

export const reverseVarianceHandler: RequestHandler = async (req, res) => {
  await assertRecordCompany(req, "tankVariancePosting", req.params.id);
  res.json(await variance.reverseTankVariance(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body));
};
