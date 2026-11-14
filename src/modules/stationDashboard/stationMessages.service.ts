import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";

/**
 * رسائل مشرف المحطات لعمّال محطة. المشرف يرسل لمحطة من شركته (المحطة تُتحقَّق بالمستأجر والشركة)، وكل عامل مُسنَد لتلك المحطة
 * يراها في تطبيقه؛ أول جلب من عامل يسجّل seenAt حتى يرى المشرف أنها وصلت. لا تصل رسالة لمحطة شركة أو مستأجر آخر.
 */
const view = (m: { id: string; body: string; createdAt: Date; seenAt: Date | null; fromStationUser?: { name: string } | null }) => ({
  id: m.id, body: m.body, createdAt: m.createdAt, seenAt: m.seenAt, from: m.fromStationUser?.name ?? null,
});

async function stationOf(tenantId: string, companyId: string, costCenterId: string) {
  const station = await prisma.costCenter.findFirst({ where: { id: costCenterId, tenantId, companyId }, select: { id: true } });
  if (!station) throw notFound("المحطة غير موجودة");
  return station.id;
}

export async function listStationMessages(tenantId: string, companyId: string, costCenterId: string) {
  const id = await stationOf(tenantId, companyId, costCenterId);
  const rows = await prisma.stationMessage.findMany({
    where: { tenantId, companyId, costCenterId: id }, orderBy: { createdAt: "desc" }, take: 30, include: { fromStationUser: { select: { name: true } } },
  });
  return rows.map(view);
}

export async function sendStationMessage(tenantId: string, companyId: string, fromStationUserId: string, costCenterId: string, body: string) {
  const text = body.trim();
  if (!text) throw badRequest("نص الرسالة مطلوب");
  const id = await stationOf(tenantId, companyId, costCenterId);
  const m = await prisma.stationMessage.create({
    data: { tenantId, companyId, costCenterId: id, fromStationUserId, body: text.slice(0, 500) },
    include: { fromStationUser: { select: { name: true } } },
  });
  return view(m);
}

/** رسائل محطة العامل (آخر 20)، وتسجيل ما لم يُرَ بعد كمَرئي من هذا العامل. */
export async function workerStationMessages(tenantId: string, stationUserId: string) {
  const worker = await prisma.stationUser.findFirst({ where: { id: stationUserId, tenantId }, select: { companyId: true, costCenterId: true } });
  if (!worker?.costCenterId) return [];
  const where = { tenantId, companyId: worker.companyId, costCenterId: worker.costCenterId };
  const rows = await prisma.stationMessage.findMany({ where, orderBy: { createdAt: "desc" }, take: 20, include: { fromStationUser: { select: { name: true } } } });
  const unseen = rows.filter((r) => !r.seenAt).map((r) => r.id);
  if (unseen.length) await prisma.stationMessage.updateMany({ where: { ...where, id: { in: unseen }, seenAt: null }, data: { seenAt: new Date(), seenByStationUserId: stationUserId } });
  // يُعاد seenAt كما كان قبل هذا الجلب، فالعامل يرى ما هو جديد عليه
  return rows.map(view);
}
