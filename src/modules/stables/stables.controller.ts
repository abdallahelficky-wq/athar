import { RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { assertCompanyAccess } from "../../middleware/auth";
import { buildLiveryContractPdf, LiveryContractView } from "../../lib/liveryContractPdf";
import { sendLiveryContractEmail } from "../../lib/mailer";
import { ensurePartyAccount } from "../../lib/partyAccounts";
import { createSalesInvoice } from "../salesInvoices/salesInvoices.service";
import { computeInvoiceLine } from "../../lib/invoiceLine";

const tenantWhere = (req: any) => ({ tenantId: req.auth!.tenantId });
async function assertCompany(req: any, companyId: string) {
  assertCompanyAccess(req.auth!, companyId);
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId: req.auth!.tenantId }, select: { businessActivity: true } });
  if (!company) throw badRequest("الشركة غير موجودة");
  if (company.businessActivity !== "horse_stables") throw badRequest("مديول الإسطبلات متاح فقط للشركات المسجلة بنشاط الإسطبلات والإعاشة");
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

const horseInclude = { stable: { select: { id: true, name: true } }, stall: { select: { id: true, number: true } }, customer: true, monthlyServices: { include: { service: true, trainer: true } } } as const;

async function ensureOwnerCustomer(tx: Prisma.TransactionClient, tenantId: string, companyId: string, body: any) {
  if (!body.ownerName?.trim()) return null;
  const ownerName = body.ownerName.trim();
  const existing = await tx.customer.findFirst({ where: { tenantId, companyId, name: ownerName, ...(body.ownerPhone ? { phone: body.ownerPhone } : {}) } });
  if (existing) return tx.customer.update({ where: { id: existing.id }, data: { phone: body.ownerPhone || existing.phone, email: body.ownerEmail || existing.email, nationalId: body.ownerNationalId || existing.nationalId } });
  const { accountId } = await ensurePartyAccount(tx, { tenantId, companyId, kind: "customer", partyName: ownerName });
  return tx.customer.create({ data: { tenantId, companyId, name: ownerName, customerType: "individual", phone: body.ownerPhone, email: body.ownerEmail, nationalId: body.ownerNationalId, paymentTerms: "شهري", accountId } });
}

async function replaceMonthlyServices(tx: Prisma.TransactionClient, tenantId: string, companyId: string, horseId: string, assignments: any[] | undefined) {
  if (!assignments) return;
  const serviceIds = assignments.map((x) => x.serviceId);
  const services = serviceIds.length ? await tx.horseCareService.findMany({ where: { id: { in: serviceIds }, tenantId, companyId, isActive: true } }) : [];
  if (services.length !== new Set(serviceIds).size) throw badRequest("إحدى الخدمات الشهرية غير موجودة أو غير فعالة");
  await tx.horseMonthlyService.deleteMany({ where: { horseId } });
  if (assignments.length) await tx.horseMonthlyService.createMany({ data: assignments.map((x) => ({ tenantId, companyId, horseId, serviceId: x.serviceId, trainerId: x.trainerId || null, quantity: x.quantity ?? 1, unitPrice: x.unitPrice ?? null })) });
}

export const listHorses: RequestHandler = async (req, res) => { const companyId = String(req.query.companyId || ""); await assertCompany(req, companyId); const search = typeof req.query.search === "string" ? req.query.search.trim() : ""; res.json(await prisma.horse.findMany({ where: { ...tenantWhere(req), companyId, ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { registrationNo: { contains: search, mode: "insensitive" } }, { ownerName: { contains: search, mode: "insensitive" } }] } : {}) }, include: horseInclude, orderBy: { name: "asc" } })); };
export const createHorse: RequestHandler = async (req, res) => { await assertCompany(req, req.body.companyId); await validatePlacement(req, req.body.companyId, req.body.stableId, req.body.stallId); res.status(201).json(await prisma.$transaction(async tx => { const { monthlyServices, ...horseData } = req.body; const customer = await ensureOwnerCustomer(tx, req.auth!.tenantId, req.body.companyId, horseData); const horse = await tx.horse.create({ data: { ...horseData, customerId: customer?.id || null, tenantId: req.auth!.tenantId } }); await replaceMonthlyServices(tx, req.auth!.tenantId, req.body.companyId, horse.id, monthlyServices); if (req.body.stallId) await tx.stableStall.update({ where: { id: req.body.stallId }, data: { status: "occupied" } }); return tx.horse.findUniqueOrThrow({ where: { id: horse.id }, include: horseInclude }); })); };
export const updateHorse: RequestHandler = async (req, res) => { const row = await assertHorse(req, req.params.id); const hasStable = Object.prototype.hasOwnProperty.call(req.body, "stableId"); const hasStall = Object.prototype.hasOwnProperty.call(req.body, "stallId"); const nextStableId = hasStable ? req.body.stableId : row.stableId; const nextStallId = hasStall ? req.body.stallId : row.stallId; if (hasStable && nextStableId !== row.stableId && !hasStall) throw badRequest("اختر البوكس من الإسطبل الجديد أو أفرغ حقل البوكس"); await validatePlacement(req, row.companyId, nextStableId, nextStallId, row.id); res.json(await prisma.$transaction(async tx => { const { monthlyServices, ...horseData } = req.body; const customer = await ensureOwnerCustomer(tx, req.auth!.tenantId, row.companyId, { ...row, ...horseData }); const horse = await tx.horse.update({ where: { id: row.id }, data: { ...horseData, customerId: customer?.id ?? row.customerId } }); await replaceMonthlyServices(tx, req.auth!.tenantId, row.companyId, row.id, monthlyServices); if (row.stallId && row.stallId !== horse.stallId) await tx.stableStall.update({ where: { id: row.stallId }, data: { status: "available" } }); if (horse.stallId) await tx.stableStall.update({ where: { id: horse.stallId }, data: { status: "occupied" } }); return tx.horse.findUniqueOrThrow({ where: { id: horse.id }, include: horseInclude }); })); };
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

const catalog = [
  ["LIV-01","livery","إعاشة كاملة: بوكس وأعلاف ورودس ونشارة وسايس ومشاية","Full livery",3300,"month"],
  ["LIV-02","livery","إعاشة للخيل العربي والبوني حتى 150 سم","Arabian horse and pony livery",3000,"month"],
  ["LIV-03","livery","إعاشة بدون سايس","Livery without groom",2950,"month"],
  ["LIV-04","livery","بايكة مكيفة صيفاً","Air-conditioned stable in summer",1000,"month"],
  ["LIV-05","livery","مشاية الخيل","Horse walker",200,"service"],
  ["NUR-01","nursing","خدمة تمريض شهرية للجروح السطحية","Monthly nursing for superficial wounds",230,"month"],
  ["VET-01","veterinary","كشف طبيب بيطري أثناء الدوام","Veterinary visit",575,"visit"],
  ["FAR-01","farrier","تحدية كاملة بحديد أوروبي بالنار","Full European shoe set",437,"service"],
  ["FAR-02","farrier","تحدية أمامية","Front shoes only",300,"service"],
  ["FAR-03","farrier","تقليم حوافر","Hoof trimming",200,"service"],
  ["BRD-01","breeding","رعاية إضافية للفرس الحامل من الشهر الخامس","Pregnant mare extra livery",650,"month"],
  ["BRD-02","breeding","رعاية المهر من الولادة حتى الفطام","Foal care until weaning",850,"month"],
  ["GRM-01","grooming","حلاقة الخيل","Clipping",575,"service"],
  ["DEN-01","dental","برد أسنان","Teeth rasping",360,"service"],
  ["TRN-03","training","تدريب الخيل 3 أيام أسبوعياً","Horse training 3 days/week",2000,"month"],
  ["TRN-06","training","تدريب الخيل 6 أيام أسبوعياً","Horse training 6 days/week",3000,"month"],
  ["CMP-01","competition","تدريب بطولات 5 أيام أسبوعياً","Competition training",3500,"month"],
  ["CMP-JED","competition","أتعاب السايس في مسابقات جدة لكل يوم","Groom at Jeddah competition",172.5,"day"],
  ["CMP-RUH","competition","أتعاب السايس في مسابقات الرياض لكل يوم","Groom at Riyadh competition",287.5,"day"],
] as const;

async function listEntity(req:any,res:any,model:string,orderBy:any={createdAt:"desc"}) { const companyId=String(req.query.companyId||""); await assertCompany(req,companyId); res.json(await (prisma as any)[model].findMany({where:{...tenantWhere(req),companyId},orderBy})); }
async function createEntity(req:any,res:any,model:string) { await assertCompany(req,req.body.companyId); res.status(201).json(await (prisma as any)[model].create({data:{...req.body,tenantId:req.auth!.tenantId}})); }
async function updateEntity(req:any,res:any,model:string,label:string) { const row=await (prisma as any)[model].findFirst({where:{id:req.params.id,...tenantWhere(req)}}); if(!row)throw notFound(`${label} غير موجود`); assertCompanyAccess(req.auth!,row.companyId); res.json(await (prisma as any)[model].update({where:{id:row.id},data:req.body})); }
async function deleteEntity(req:any,res:any,model:string,label:string) { const row=await (prisma as any)[model].findFirst({where:{id:req.params.id,...tenantWhere(req)}}); if(!row)throw notFound(`${label} غير موجود`); assertCompanyAccess(req.auth!,row.companyId); await (prisma as any)[model].delete({where:{id:row.id}}); res.status(204).send(); }

export const listTrainers:RequestHandler=(q,s)=>listEntity(q,s,"ridingTrainer",{name:"asc"}); export const createTrainer:RequestHandler=(q,s)=>createEntity(q,s,"ridingTrainer"); export const updateTrainer:RequestHandler=(q,s)=>updateEntity(q,s,"ridingTrainer","المدرب"); export const deleteTrainer:RequestHandler=(q,s)=>deleteEntity(q,s,"ridingTrainer","المدرب");
export const listLessonTypes:RequestHandler=(q,s)=>listEntity(q,s,"ridingLessonType",{name:"asc"}); export const createLessonType:RequestHandler=(q,s)=>createEntity(q,s,"ridingLessonType"); export const updateLessonType:RequestHandler=(q,s)=>updateEntity(q,s,"ridingLessonType","نوع الحصة"); export const deleteLessonType:RequestHandler=(q,s)=>deleteEntity(q,s,"ridingLessonType","نوع الحصة");
export const listLessons:RequestHandler=async(req,res)=>{const companyId=String(req.query.companyId||"");await assertCompany(req,companyId);res.json(await prisma.ridingLesson.findMany({where:{...tenantWhere(req),companyId},include:{customer:true,salesInvoice:{select:{id:true,invoiceNumber:true,status:true}},},orderBy:{scheduledAt:"desc"}}))};
export const createLesson:RequestHandler=async(req,res)=>{await assertCompany(req,req.body.companyId);const lesson=await prisma.$transaction(async tx=>{const customer=await ensureOwnerCustomer(tx,req.auth!.tenantId,req.body.companyId,{ownerName:req.body.studentName,ownerPhone:req.body.studentPhone,ownerEmail:req.body.studentEmail});return tx.ridingLesson.create({data:{...req.body,customerId:customer?.id||null,tenantId:req.auth!.tenantId}})});res.status(201).json(lesson)};
export const updateLesson:RequestHandler=async(req,res)=>{const row=await prisma.ridingLesson.findFirst({where:{id:req.params.id,...tenantWhere(req)}});if(!row)throw notFound("الحصة غير موجودة");assertCompanyAccess(req.auth!,row.companyId);if(row.salesInvoiceId&&["price","participants","trainerId","studentName","studentPhone","studentEmail","scheduledAt"].some(key=>Object.prototype.hasOwnProperty.call(req.body,key)))throw badRequest("لا يمكن تعديل البيانات المالية للحصة بعد إصدار فاتورتها");res.json(await prisma.ridingLesson.update({where:{id:row.id},data:req.body}))};
export const deleteLesson:RequestHandler=async(req,res)=>{const row=await prisma.ridingLesson.findFirst({where:{id:req.params.id,...tenantWhere(req)}});if(!row)throw notFound("الحصة غير موجودة");assertCompanyAccess(req.auth!,row.companyId);if(row.salesInvoiceId)throw badRequest("لا يمكن حذف حصة صدرت لها فاتورة");await prisma.ridingLesson.delete({where:{id:row.id}});res.status(204).send()};

export const createLessonInvoice:RequestHandler=async(req,res)=>{
  const lesson=await prisma.ridingLesson.findFirst({where:{id:req.params.id,...tenantWhere(req)},include:{customer:true}});
  if(!lesson)throw notFound("الحصة غير موجودة");assertCompanyAccess(req.auth!,lesson.companyId);
  if(lesson.salesInvoiceId)throw badRequest("تم إصدار فاتورة لهذه الحصة بالفعل");
  if(lesson.status==="cancelled"||lesson.status==="no_show")throw badRequest("لا يمكن إصدار فاتورة لحصة ملغاة أو لم يحضرها المتدرب");
  let customer=lesson.customer;
  if(!customer){customer=await prisma.$transaction(tx=>ensureOwnerCustomer(tx,req.auth!.tenantId,lesson.companyId,{ownerName:lesson.studentName,ownerPhone:lesson.studentPhone,ownerEmail:lesson.studentEmail}));}
  if(!customer)throw badRequest("بيانات المتدرب غير مكتملة لإنشاء العميل");
  const revenueAccount=await prisma.account.findFirst({where:{tenantId:req.auth!.tenantId,companyId:lesson.companyId,code:"411002",isPosting:true,isActive:true,isArchived:false}});
  if(!revenueAccount)throw badRequest("حساب إيرادات التدريب والحصص (411002) غير موجود في شجرة الحسابات");
  const invoice=await createSalesInvoice(req.auth!.tenantId,req.auth!.sub,{companyId:lesson.companyId,customerId:customer.id,date:lesson.scheduledAt,post:false,lines:[{accountId:revenueAccount.id,description:`حصة فروسية — ${lesson.studentName}${lesson.participants>1?` (${lesson.participants} مشاركين)`:""}`,quantity:1,unitPrice:Number(lesson.price),discountPct:0,priceIncludesVat:true,vatApplicable:true}]});
  await prisma.ridingLesson.update({where:{id:lesson.id},data:{customerId:customer.id,salesInvoiceId:invoice.id}});
  res.status(201).json(invoice);
};
export const listCompetitions:RequestHandler=(q,s)=>listEntity(q,s,"equestrianCompetition",{startDate:"desc"}); export const createCompetition:RequestHandler=(q,s)=>createEntity(q,s,"equestrianCompetition"); export const updateCompetition:RequestHandler=(q,s)=>updateEntity(q,s,"equestrianCompetition","المسابقة"); export const deleteCompetition:RequestHandler=(q,s)=>deleteEntity(q,s,"equestrianCompetition","المسابقة");
export const listCareServices:RequestHandler=async(req,res)=>{const companyId=String(req.query.companyId||"");await assertCompany(req,companyId);const service=(prisma as any).horseCareService;if(!await service.count({where:{...tenantWhere(req),companyId}}))await service.createMany({data:catalog.map(([code,category,nameAr,nameEn,price,unit])=>({tenantId:req.auth!.tenantId,companyId,code,category,nameAr,nameEn,price,unit}))});res.json(await service.findMany({where:{...tenantWhere(req),companyId},orderBy:[{category:"asc"},{nameAr:"asc"}]}))};
export const createCareService:RequestHandler=(q,s)=>createEntity(q,s,"horseCareService"); export const updateCareService:RequestHandler=(q,s)=>updateEntity(q,s,"horseCareService","الخدمة"); export const deleteCareService:RequestHandler=(q,s)=>deleteEntity(q,s,"horseCareService","الخدمة");

const monthStart = (value: string) => {
  if (!/^\d{4}-\d{2}$/.test(value)) throw badRequest("الشهر مطلوب بصيغة YYYY-MM");
  return new Date(`${value}-01T00:00:00.000Z`);
};

export const listBoardingOwners: RequestHandler = async (req, res) => {
  const companyId = String(req.query.companyId || ""); await assertCompany(req, companyId);
  // تعبئة رجعية آمنة للخيول الموجودة قبل إضافة الربط: أول فتح للشاشة ينشئ عميل المالك وحسابه
  // التفصيلي ثم يربطه بالخيل، حتى لا يضطر المستخدم لإعادة حفظ كل خيل يدوياً.
  const legacyHorses = await prisma.horse.findMany({ where: { tenantId: req.auth!.tenantId, companyId, customerId: null, ownerName: { not: null } } });
  if (legacyHorses.length) await prisma.$transaction(async (tx) => {
    for (const horse of legacyHorses) {
      const customer = await ensureOwnerCustomer(tx, req.auth!.tenantId, companyId, horse);
      if (customer) await tx.horse.update({ where: { id: horse.id }, data: { customerId: customer.id } });
    }
  });
  const customers = await prisma.customer.findMany({
    where: { tenantId: req.auth!.tenantId, companyId, horses: { some: { status: { notIn: ["sold", "deceased"] } } } },
    include: { horses: { where: { status: { notIn: ["sold", "deceased"] } }, include: { monthlyServices: { where: { isActive: true }, include: { service: true, trainer: true } } } } },
    orderBy: { name: "asc" },
  });
  res.json(customers);
};

export const createBoardingInvoice: RequestHandler = async (req, res) => {
  const { companyId, customerId, billingMonth, trainerSelections = {} } = req.body;
  await assertCompany(req, companyId); const period = monthStart(billingMonth);
  const existing = await prisma.horseBoardingInvoice.findUnique({ where: { companyId_customerId_billingMonth: { companyId, customerId, billingMonth: period } }, include: { salesInvoice: true } });
  if (existing) throw badRequest(`تم إنشاء فاتورة إعاشة لهذا المالك عن الشهر المحدد بالفعل (${existing.salesInvoice.invoiceNumber})`);
  const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId: req.auth!.tenantId, companyId } });
  if (!customer) throw badRequest("مالك الخيل غير موجود ضمن عملاء الشركة");
  const horses = await prisma.horse.findMany({
    where: { tenantId: req.auth!.tenantId, companyId, customerId, status: { notIn: ["sold", "deceased"] } },
    include: { monthlyServices: { where: { isActive: true, startDate: { lte: new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 0, 23, 59, 59)) }, OR: [{ endDate: null }, { endDate: { gte: period } }] }, include: { service: true } } },
  });
  const assignments = horses.flatMap((horse) => horse.monthlyServices.map((assignment) => ({ horse, assignment })));
  if (!assignments.length) throw badRequest("لا توجد خدمات شهرية فعالة مرتبطة بخيول هذا المالك");
  const trainingAssignments = assignments.filter(({ assignment }) => ["training", "competition"].includes(assignment.service.category));
  const selectedTrainerIds = [...new Set(trainingAssignments.map(({ assignment }) => trainerSelections[assignment.id] || assignment.trainerId).filter(Boolean))] as string[];
  if (trainingAssignments.some(({ assignment }) => !(trainerSelections[assignment.id] || assignment.trainerId))) throw badRequest("حدد المدرب لكل خدمة تدريب قبل إنشاء الفاتورة");
  if (selectedTrainerIds.length) {
    const validTrainers = await prisma.ridingTrainer.count({ where: { id: { in: selectedTrainerIds }, tenantId: req.auth!.tenantId, companyId, isActive: true } });
    if (validTrainers !== selectedTrainerIds.length) throw badRequest("أحد المدربين المحددين غير موجود أو غير فعال");
  }
  const accountCodes = [...new Set(assignments.map(({ assignment }) => ["training", "competition"].includes(assignment.service.category) ? "411002" : "411001"))];
  const accounts = await prisma.account.findMany({ where: { tenantId: req.auth!.tenantId, companyId, code: { in: accountCodes }, isPosting: true, isActive: true, isArchived: false } });
  const accountByCode = new Map(accounts.map((account) => [account.code, account.id]));
  if (accounts.length !== accountCodes.length) throw badRequest("شجرة الحسابات لا تحتوي حسابات إيرادات الإعاشة والتدريب المطلوبة (411001 و411002)");
  const invoiceLines = assignments.map(({ horse, assignment }) => ({
    accountId: assignment.service.revenueAccountId || accountByCode.get(["training", "competition"].includes(assignment.service.category) ? "411002" : "411001")!,
    description: `${horse.name} — ${assignment.service.nameAr}`,
    quantity: Number(assignment.quantity), unitPrice: Number(assignment.unitPrice ?? assignment.service.price ?? 0), discountPct: 0,
    priceIncludesVat: assignment.service.priceIncludesVat, vatApplicable: true,
  }));
  if (invoiceLines.some((line) => line.unitPrice <= 0)) throw badRequest("إحدى الخدمات الشهرية بلا سعر؛ حدّث سعرها قبل إنشاء الفاتورة");
  const invoice = await createSalesInvoice(req.auth!.tenantId, req.auth!.sub, { companyId, customerId, date: new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 0, 12)), lines: invoiceLines, post: false });
  try {
    const boarding = await prisma.horseBoardingInvoice.create({
      data: { tenantId: req.auth!.tenantId, companyId, customerId, billingMonth: period, salesInvoiceId: invoice.id,
        lines: { create: assignments.map(({ horse, assignment }) => {
          const price = Number(assignment.unitPrice ?? assignment.service.price ?? 0); const quantity = Number(assignment.quantity);
          const amounts = computeInvoiceLine({ quantity, unitPrice: price, priceIncludesVat: assignment.service.priceIncludesVat, vatApplicable: true });
          return { horseId: horse.id, serviceId: assignment.serviceId, trainerId: trainerSelections[assignment.id] || assignment.trainerId || null, quantity, unitPrice: price, netAmount: amounts.subtotal, vatAmount: amounts.vat, totalAmount: amounts.total };
        }) },
      }, include: { salesInvoice: true, lines: { include: { horse: true, service: true } } },
    });
    res.status(201).json(boarding);
  } catch (error) {
    await prisma.salesInvoice.deleteMany({ where: { id: invoice.id, tenantId: req.auth!.tenantId, status: "draft" } });
    throw error;
  }
};

export const trainerCommissionReport: RequestHandler = async (req, res) => {
  const companyId = String(req.query.companyId || ""); await assertCompany(req, companyId);
  const from = typeof req.query.from === "string" && req.query.from ? new Date(`${req.query.from}T00:00:00.000Z`) : undefined;
  const to = typeof req.query.to === "string" && req.query.to ? new Date(`${req.query.to}T23:59:59.999Z`) : undefined;
  const rows = await prisma.trainerCommission.findMany({
    where: { tenantId: req.auth!.tenantId, companyId, ...(from || to ? { periodStart: { lte: to }, periodEnd: { gte: from } } : {}) },
    include: { trainer: true, horse: true, salesInvoice: { select: { invoiceNumber: true, date: true, status: true } } },
    orderBy: [{ trainer: { name: "asc" } }, { periodStart: "asc" }],
  });
  const totals = rows.reduce((acc, row) => {
    const commission = Number(row.commissionAmount); const net = Number(row.netTrainingRevenue);
    acc.netRevenue += net; acc.commission += commission;
    if (row.sourceType === "riding_lesson") { acc.lessonRevenue += net; acc.lessonCommission += commission; }
    else { acc.horseTrainingRevenue += net; acc.horseTrainingCommission += commission; }
    return acc;
  }, { netRevenue: 0, commission: 0, lessonRevenue: 0, lessonCommission: 0, horseTrainingRevenue: 0, horseTrainingCommission: 0 });
  res.json({ rows, totals });
};
