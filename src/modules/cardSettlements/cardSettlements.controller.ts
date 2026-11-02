import { RequestHandler } from "express";
import { CardSettlementChannel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest } from "../../lib/httpError";
import { assertCompanyAccess } from "../../middleware/auth";
import * as service from "./cardSettlements.service";

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const q = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);

function requireCompany(req: Parameters<RequestHandler>[0]) {
  const companyId = q(req.query.companyId) ?? q(req.body?.companyId);
  if (!companyId) throw badRequest("الشركة مطلوبة");
  assertCompanyAccess(req.auth!, companyId);
  return companyId;
}

function channelOf(v: unknown, required: boolean): CardSettlementChannel | undefined {
  const value = q(v);
  if (!value) {
    if (required) throw badRequest("حدّد قناة التحصيل (الشبكة أو بطاقات الوقود)");
    return undefined;
  }
  if (value !== "network" && value !== "fuel_card") throw badRequest("حدّد قناة التحصيل (الشبكة أو بطاقات الوقود)");
  return value;
}

const range = (req: Parameters<RequestHandler>[0]) => {
  const from = q(req.query.from);
  const to = q(req.query.to);
  if ((from && !dateOnly.test(from)) || (to && !dateOnly.test(to))) throw badRequest("صيغة التاريخ يجب أن تكون YYYY-MM-DD");
  return { from, to };
};

export const listHandler: RequestHandler = async (req, res) => {
  const companyId = requireCompany(req);
  res.json(await service.listCardSettlements(req.auth!.tenantId, companyId, { ...range(req), channel: channelOf(req.query.channel, false), costCenterId: q(req.query.costCenterId) }));
};

export const reconciliationHandler: RequestHandler = async (req, res) => {
  const companyId = requireCompany(req);
  const { from, to } = range(req);
  if (!from || !to) throw badRequest("حدّد فترة المطابقة (من، إلى)");
  res.json(await service.cardReconciliation(req.auth!.tenantId, companyId, { from, to, channel: channelOf(req.query.channel, true)!, costCenterId: q(req.query.costCenterId) }));
};

export const createHandler: RequestHandler = async (req, res) => {
  requireCompany(req);
  res.status(201).json(await service.createCardSettlement(req.auth!.tenantId, req.auth!.sub, req.body));
};

/** التسوية المحمَّلة بالمعرّف: يُتحقَّق من شركتها نفسها قبل العكس (لا من طلب العميل). */
export const reverseHandler: RequestHandler = async (req, res) => {
  const row = await prisma.cardSettlement.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId }, select: { companyId: true } });
  if (row) assertCompanyAccess(req.auth!, row.companyId);
  res.json(await service.reverseCardSettlement(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body));
};
