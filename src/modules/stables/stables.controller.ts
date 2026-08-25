import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { assertCompanyAccess } from "../../middleware/auth";
import { buildLiveryContractPdf, LiveryContractView } from "../../lib/liveryContractPdf";
import { sendLiveryContractEmail } from "../../lib/mailer";

const tenantWhere = (req: any) => ({ tenantId: req.auth!.tenantId });
async function assertCompany(req: any, companyId: string) {
  assertCompanyAccess(req.auth!, companyId);
  if (!await prisma.company.findFirst({ where: { id: companyId, tenantId: req.auth!.tenantId } })) throw badRequest("الشركة غير موجودة");
}
async function assertStable(req: any, id: string, companyId?: string) {
  const row = await prisma.stable.findFirst({ where: { id, ...tenantWhere(req), ...(companyId ? { companyId } : {}) } });
  if (!row) throw badRequest("الإسطبل غير موجود أو لا يتبع الشركة المحددة");
  assertCompanyAccess(req.auth!, row.companyId);
  return row;
}
async function assertHorse(req: any, id: string, companyId?: string) {
  const row = await prisma.horse.findFirst({ where: { id, ...tenantWhere(req), ...(companyId ? { companyId } : {}) } });
  if (!row) throw badRequest("الخيل غير موجود أو لا يتبع الشركة المحددة");
  assertCompanyAccess(req.auth!, row.companyId);
  return row;
}
async function validatePlacement(req: any, companyId: string, stableId?: string | null, stallId?: string | null, horseId?: string) {
  if (stallId && !stableId) throw badRequest("يجب اختيار الإسطبل عند اختيار البوكس");
  if (stableId) await assertStable(req, stableId, companyId);
  if (!stallId) return;
  const stall = await prisma.stableStall.findFirst({ where: { id: stallId, tenantId: req.auth!.tenantId, companyId } });
  if (!stall || (stableId && stall.stableId !== stableId)) throw badRequest("البوكس لا يتبع الإسطبل المحدد");
  const occupant = await prisma.horse.findFirst({ where: { stallId, id: horseId ? { not: horseId } : undefined } });
  if (occupant) throw badRequest("البوكس مشغول بخيل آخر");
}

export const overview: RequestHandler = async (req, res) => {
  const companyId = String(req.query.companyId || ""); await assertCompany(req, companyId);
  const where = { ...tenantWhere(req), companyId };
  const [stables, horses, availableStalls, activeContracts, upcomingCare] = await Promise.all([
    prisma.stable.count({ where: { ...where, isArchived: false } }), prisma.horse.count({ where: { ...where, status: { notIn: ["sold", "deceased"] } } }),
    prisma.stableStall.count({ where: { ...where, status: "available" } }), prisma.boardingContract.count({ where: { ...where, status: "active" } }),
    prisma.horseCareRecord.findMany({ where: { ...where, nextDueDate: { gte: new Date(), lte: new Date(Date.now() + 30 * 86400000) } }, include: { horse: { select: { id: true, name: true } } }, orderBy: { nextDueDate: "asc" }, take: 20 }),
  ]); res.json({ stables, horses, availableStalls, activeContracts, upcomingCare });
};

export const listStables: RequestHandler = async (req, res) => { const companyId = String(req.query.companyId || ""); await assertCompany(req, companyId); res.json(await prisma.stable.findMany({ where: { ...tenantWhere(req), companyId }, include: { _count: { select: { stalls: true, horses: true } } }, orderBy: { name: "asc" } })); };
export const createStable: RequestHandler = async (req, res) => { await assertCompany(req, req.body.companyId); res.status(201).json(await prisma.stable.create({ data: { ...req.body, tenantId: req.auth!.tenantId } })); };
export const updateStable: RequestHandler = async (req, res) => { const row = await assertStable(req, req.params.id); res.json(await prisma.stable.update({ where: { id: row.id }, data: req.body })); };
export const deleteStable: RequestHandler = async (req, res) => { const row = await assertStable(req, req.params.id); const count = await prisma.horse.count({ where: { stableId: row.id } }); if (count) throw badRequest("لا يمكن حذف إسطبل يحتوي على خيول؛ انقل الخيول أو استخدم الأرشفة"); await prisma.stable.delete({ where: { id: row.id } }); res.status(204).send(); };

export const listStalls: RequestHandler = async (req, res) => { const companyId = String(req.query.companyId || ""); await assertCompany(req, companyId); res.json(await prisma.stableStall.findMany({ where: { ...tenantWhere(req), companyId, stableId: typeof req.query.stableId === "string" ? req.query.stableId : undefined }, include: { stable: { select: { id: true, name: true } }, horses: { select: { id: true, name: true } } }, orderBy: [{ stable: { name: "asc" } }, { number: "asc" }] })); };
export const createStall: RequestHandler = async (req, res) => { await assertCompany(req, req.body.companyId); await assertStable(req, req.body.stableId, req.body.companyId); res.status(201).json(await prisma.stableStall.create({ data: { ...req.body, tenantId: req.auth!.tenantId } })); };
export const updateStall: RequestHandler = async (req, res) => { const row = await prisma.stableStall.findFirst({ where: { id: req.params.id, ...tenantWhere(req) } }); if (!row) throw notFound("البوكس غير موجود"); assertCompanyAccess(req.auth!, row.companyId); res.json(await prisma.stableStall.update({ where: { id: row.id }, data: req.body })); };
export const deleteStall: RequestHandler = async (req, res) => { const row = await prisma.stableStall.findFirst({ where: { id: req.params.id, ...tenantWhere(req) }, include: { _count: { select: { horses: true, contracts: true } } } }); if (!row) throw notFound("البوكس غير موجود"); assertCompanyAccess(req.auth!, row.companyId); if (row._count.horses || row._count.contracts) throw badRequest("لا يمكن حذف بوكس مستخدم"); await prisma.stableStall.delete({ where: { id: row.id } }); res.status(204).send(); };

export const listHorses: RequestHandler = async (req, res) => { const companyId = String(req.query.companyId || ""); await assertCompany(req, companyId); const search = typeof req.query.search === "string" ? req.query.search.trim() : ""; res.json(await prisma.horse.findMany({ where: { ...tenantWhere(req), companyId, ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { registrationNo: { contains: search, mode: "insensitive" } }, { ownerName: { contains: search, mode: "insensitive" } }] } : {}) }, include: { stable: { select: { id: true, name: true } }, stall: { select: { id: true, number: true } } }, orderBy: { name: "asc" } })); };
export const createHorse: RequestHandler = async (req, res) => { await assertCompany(req, req.body.companyId); await validatePlacement(req, req.body.companyId, req.body.stableId, req.body.stallId); res.status(201).json(await prisma.$transaction(async tx => { const horse = await tx.horse.create({ data: { ...req.body, tenantId: req.auth!.tenantId } }); if (req.body.stallId) await tx.stableStall.update({ where: { id: req.body.stallId }, data: { status: "occupied" } }); return horse; })); };
export const updateHorse: RequestHandler = async (req, res) => { const row = await assertHorse(req, req.params.id); const hasStable = Object.prototype.hasOwnProperty.call(req.body, "stableId"); const hasStall = Object.prototype.hasOwnProperty.call(req.body, "stallId"); const nextStableId = hasStable ? req.body.stableId : row.stableId; const nextStallId = hasStall ? req.body.stallId : row.stallId; if (hasStable && nextStableId !== row.stableId && !hasStall) throw badRequest("اختر البوكس من الإسطبل الجديد أو أفرغ حقل البوكس"); await validatePlacement(req, row.companyId, nextStableId, nextStallId, row.id); res.json(await prisma.$transaction(async tx => { const horse = await tx.horse.update({ where: { id: row.id }, data: req.body }); if (row.stallId && row.stallId !== horse.stallId) await tx.stableStall.update({ where: { id: row.stallId }, data: { status: "available" } }); if (horse.stallId) await tx.stableStall.update({ where: { id: horse.stallId }, data: { status: "occupied" } }); return horse; })); };
export const deleteHorse: RequestHandler = async (req, res) => { const row = await assertHorse(req, req.params.id); if (await prisma.boardingContract.count({ where: { horseId: row.id } })) throw badRequest("لا يمكن حذف خيل له عقود؛ غيّر حالته بدلاً من الحذف"); await prisma.$transaction(async tx => { await tx.horse.delete({ where: { id: row.id } }); if (row.stallId) await tx.stableStall.update({ where: { id: row.stallId }, data: { status: "available" } }); }); res.status(204).send(); };

export const listContracts: RequestHandler = async (req, res) => { const companyId = String(req.query.companyId || ""); await assertCompany(req, companyId); res.json(await prisma.boardingContract.findMany({ where: { ...tenantWhere(req), companyId }, include: { horse: { select: { id: true, name: true } }, stable: { select: { id: true, name: true } }, stall: { select: { id: true, number: true } } }, orderBy: { startDate: "desc" } })); };
export const createContract: RequestHandler = async (req, res) => { await assertCompany(req, req.body.companyId); await assertStable(req, req.body.stableId, req.body.companyId); await assertHorse(req, req.body.horseId, req.body.companyId); await validatePlacement(req, req.body.companyId, req.body.stableId, req.body.stallId, req.body.horseId); res.status(201).json(await prisma.boardingContract.create({ data: { ...req.body, tenantId: req.auth!.tenantId } })); };
export const updateContract: RequestHandler = async (req, res) => { const row = await prisma.boardingContract.findFirst({ where: { id: req.params.id, ...tenantWhere(req) } }); if (!row) throw notFound("عقد الإيواء غير موجود"); assertCompanyAccess(req.auth!, row.companyId); const nextStable = req.body.stableId ?? row.stableId; const nextHorse = req.body.horseId ?? row.horseId; await assertStable(req, nextStable, row.companyId); await assertHorse(req, nextHorse, row.companyId); await validatePlacement(req, row.companyId, nextStable, req.body.stallId === undefined ? row.stallId : req.body.stallId, nextHorse); const start = req.body.startDate ?? row.startDate; const end = req.body.endDate === undefined ? row.endDate : req.body.endDate; if (end && end < start) throw badRequest("تاريخ النهاية يجب أن يكون بعد تاريخ البداية"); res.json(await prisma.boardingContract.update({ where: { id: row.id }, data: req.body })); };
export const deleteContract: RequestHandler = async (req, res) => { const row = await prisma.boardingContract.findFirst({ where: { id: req.params.id, ...tenantWhere(req) } }); if (!row) throw notFound("عقد الإيواء غير موجود"); assertCompanyAccess(req.auth!, row.companyId); await prisma.boardingContract.delete({ where: { id: row.id } }); res.status(204).send(); };

async function contractDocument(req: any, id: string) {
  const row = await prisma.boardingContract.findFirst({ where: { id, ...tenantWhere(req) }, include: { company: true, stable: true, stall: true, horse: true } });
  if (!row) throw notFound("عقد الإيواء غير موجود");
  assertCompanyAccess(req.auth!, row.companyId);
  const address = [row.company.addressCity, row.company.addressDistrict, row.company.addressStreet, row.company.addressBuilding, row.company.addressPostalCode].filter(Boolean).join("، ");
  const horseDescription = [row.horse.breed, row.horse.color, row.horse.sex, row.horse.registrationNo && `رقم التسجيل ${row.horse.registrationNo}`, row.horse.microchipNo && `الشريحة ${row.horse.microchipNo}`].filter(Boolean).join("، ");
  const view: LiveryContractView = { contractNumber: row.contractNumber, companyName: row.company.name, companyCr: row.company.crNumber, companyAddress: address, companyPhone: row.company.phone, companyEmail: row.company.officialEmail, ownerName: row.ownerName || row.horse.ownerName, ownerNationality: row.ownerNationality, ownerNationalId: row.ownerNationalId, ownerIdIssuePlace: row.ownerIdIssuePlace, ownerPhone: row.ownerPhone || row.horse.ownerPhone, ownerEmail: row.ownerEmail, ownerCity: row.ownerCity, ownerDistrict: row.ownerDistrict, ownerStreet: row.ownerStreet, ownerBuildingNo: row.ownerBuildingNo, ownerPostalCode: row.ownerPostalCode, horseName: row.horse.name, horseDescription, stableName: row.stable.name, stallNumber: row.stall?.number, startDate: row.startDate, endDate: row.endDate, monthlyFee: row.monthlyFee.toString(), depositAmount: row.depositAmount?.toString() };
  return { row, view, pdf: await buildLiveryContractPdf(view) };
}

export const downloadContractPdf: RequestHandler = async (req, res) => {
  const { row, pdf } = await contractDocument(req, req.params.id);
  const filename = `livery-contract-${row.contractNumber || row.id}.pdf`;
  res.setHeader("Content-Type", "application/pdf"); res.setHeader("Content-Disposition", `attachment; filename="${filename}"`); res.send(pdf);
};

export const emailContract: RequestHandler = async (req, res) => {
  const { row, view, pdf } = await contractDocument(req, req.params.id); const to = req.body.email || row.ownerEmail;
  if (!to) throw badRequest("أدخل بريد المالك في بيانات العقد أو في طلب الإرسال");
  const filename = `livery-contract-${row.contractNumber || row.id}.pdf`;
  await sendLiveryContractEmail({ to, ownerName: view.ownerName || "مالك الخيل", companyName: view.companyName, contractNumber: row.contractNumber, pdfBuffer: pdf, pdfFileName: filename });
  await prisma.boardingContract.update({ where: { id: row.id }, data: { ownerEmail: to, sentAt: new Date() } }); res.json({ sent: true, email: to });
};

export const listCare: RequestHandler = async (req, res) => { const companyId = String(req.query.companyId || ""); await assertCompany(req, companyId); res.json(await prisma.horseCareRecord.findMany({ where: { ...tenantWhere(req), companyId, horseId: typeof req.query.horseId === "string" ? req.query.horseId : undefined }, include: { horse: { select: { id: true, name: true } } }, orderBy: { performedAt: "desc" } })); };
export const createCare: RequestHandler = async (req, res) => { await assertCompany(req, req.body.companyId); await assertHorse(req, req.body.horseId, req.body.companyId); res.status(201).json(await prisma.horseCareRecord.create({ data: { ...req.body, tenantId: req.auth!.tenantId } })); };
export const updateCare: RequestHandler = async (req, res) => { const row = await prisma.horseCareRecord.findFirst({ where: { id: req.params.id, ...tenantWhere(req) } }); if (!row) throw notFound("سجل الرعاية غير موجود"); assertCompanyAccess(req.auth!, row.companyId); res.json(await prisma.horseCareRecord.update({ where: { id: row.id }, data: req.body })); };
export const deleteCare: RequestHandler = async (req, res) => { const row = await prisma.horseCareRecord.findFirst({ where: { id: req.params.id, ...tenantWhere(req) } }); if (!row) throw notFound("سجل الرعاية غير موجود"); assertCompanyAccess(req.auth!, row.companyId); await prisma.horseCareRecord.delete({ where: { id: row.id } }); res.status(204).send(); };

