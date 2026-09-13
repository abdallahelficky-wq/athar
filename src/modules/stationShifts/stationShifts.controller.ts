import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { assertCompanyAccess } from "../../middleware/auth";
import * as service from "./stationShifts.service";

/** نسخة مخصّصة من assertRecordCompanyScope العامة — للمسارات التي تُحمَّل بمعرّف الوردية مباشرة
 * (شاشات المحاسب)، لا نطاق العامل الضمني (my-station/شاشاته هو دائماً وردية يملكها بنفسه أصلاً،
 * فلا حاجة لهذا الفحص هناك — service.getOwnedOpenShift يتحقق من ملكيته مباشرة بدل ذلك). */
async function assertShiftCompanyAccess(auth: { tenantId: string; companyScope: string }, shiftId: string) {
  const shift = await prisma.stationShift.findFirst({ where: { id: shiftId, tenantId: auth.tenantId }, select: { companyId: true } });
  if (shift) assertCompanyAccess(auth, shift.companyId);
}

// --- نقاط نهاية العامل ------------------------------------------------------

export const getMyStationHandler: RequestHandler = async (req, res) => {
  res.json(await service.getMyStation(req.auth!.tenantId, req.auth!.sub));
};

export const openShiftHandler: RequestHandler = async (req, res) => {
  const shift = await service.openShift(req.auth!.tenantId, req.auth!.sub, req.body);
  res.status(201).json(shift);
};

export const submitReadingHandler: RequestHandler = async (req, res) => {
  const reading = await service.submitReading(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body);
  res.status(201).json(reading);
};

export const updateCollectionsHandler: RequestHandler = async (req, res) => {
  const collection = await service.updateCollections(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body);
  res.json(collection);
};

export const addCreditSaleHandler: RequestHandler = async (req, res) => {
  const creditSale = await service.addCreditSale(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body);
  res.status(201).json(creditSale);
};

export const addExpenseHandler: RequestHandler = async (req, res) => {
  const expense = await service.addExpense(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body);
  res.status(201).json(expense);
};

export const getShiftSummaryHandler: RequestHandler = async (req, res) => {
  await assertShiftCompanyAccess(req.auth!, req.params.id);
  res.json(await service.getShiftSummary(req.auth!.tenantId, req.params.id));
};

export const submitShiftHandler: RequestHandler = async (req, res) => {
  const shift = await service.submitShift(req.auth!.tenantId, req.auth!.sub, req.params.id);
  res.json(shift);
};

// --- نقاط نهاية المحاسب ------------------------------------------------------

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
