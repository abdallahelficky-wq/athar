import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { assertCompanyAccess } from "../../middleware/auth";
import * as service from "./stationShifts.service";

// نقاط نهاية العامل (فتح/تعديل وردية، القراءات، التحصيل، المصروفات...) انتقلت بالكامل إلى
// stationShifts.portal.routes.ts (بوابة الموظف، Employee لا User) — هذا الملف الآن مقصور تماماً
// على شاشة المحاسب (User/Position، requireActionPermission)، راجع الملف الآخر للتفاصيل.

/** نسخة مخصّصة من assertRecordCompanyScope العامة — لمسارات المحاسب المحمَّلة بمعرّف الوردية
 * مباشرة. */
async function assertShiftCompanyAccess(auth: { tenantId: string; companyScope: string }, shiftId: string) {
  const shift = await prisma.stationShift.findFirst({ where: { id: shiftId, tenantId: auth.tenantId }, select: { companyId: true } });
  if (shift) assertCompanyAccess(auth, shift.companyId);
}

export const listPendingShiftsHandler: RequestHandler = async (req, res) => {
  const { companyId } = req.query;
  res.json(await service.listPendingShifts(req.auth!.tenantId, typeof companyId === "string" ? companyId : undefined));
};

export const getShiftByIdHandler: RequestHandler = async (req, res) => {
  await assertShiftCompanyAccess(req.auth!, req.params.id);
  res.json(await service.getShiftById(req.auth!.tenantId, req.params.id));
};

export const correctReadingHandler: RequestHandler = async (req, res) => {
  await assertShiftCompanyAccess(req.auth!, req.params.id);
  const updated = await service.correctReading(
    req.auth!.tenantId,
    req.auth!.sub,
    req.params.id,
    req.params.readingId,
    req.body.accountantConfirmedValue,
  );
  res.json(updated);
};

export const approveShiftHandler: RequestHandler = async (req, res) => {
  await assertShiftCompanyAccess(req.auth!, req.params.id);
  res.json(await service.approveShift(req.auth!.tenantId, req.auth!.sub, req.params.id));
};

export const postShiftHandler: RequestHandler = async (req, res) => {
  await assertShiftCompanyAccess(req.auth!, req.params.id);
  res.json(await service.postShift(req.auth!.tenantId, req.auth!.sub, req.params.id));
};

export const rejectShiftHandler: RequestHandler = async (req, res) => {
  await assertShiftCompanyAccess(req.auth!, req.params.id);
  const shift = await service.rejectShift(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body.reasonCode, req.body.note);
  res.json(shift);
};
