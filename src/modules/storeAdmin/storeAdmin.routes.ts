import { Router, RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate, enforceCompanyScope, blockMutationsWhenReadOnly, requireRole, assertRecordCompanyScope, assertCompanyAccess } from "../../middleware/auth";
import { requirePositionAction } from "../../middleware/positionMatrix";
import { validateBody } from "../../middleware/validate";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict, notFound } from "../../lib/httpError";

/**
 * إعدادات المتجر الإلكتروني التي لها جداولها: مناطق الشحن وكوبونات الخصم. مستخدم مصادَق ضمن نطاق شركته، وبصلاحية إعدادات
 * الشركة (هي امتداد لقسم المتجر في بيانات الشركة). المتجر العام يقرأ هذه الجداول من src/modules/store ولا يكتبها إلا لعدّ
 * استخدام الكوبون عند إنشاء طلب.
 */
const money = z.coerce.number().min(0).max(1_000_000);

export const shippingZoneCreateSchema = z.object({ companyId: z.string().min(1), city: z.string().trim().min(1).max(60), fee: money, isActive: z.boolean().optional() });
export const shippingZoneUpdateSchema = z.object({ city: z.string().trim().min(1).max(60).optional(), fee: money.optional(), isActive: z.boolean().optional() });

const couponFields = {
  code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/, "رمز الخصم حروف إنجليزية وأرقام فقط").transform((v) => v.toUpperCase()),
  type: z.enum(["percent", "fixed"]),
  value: z.coerce.number().gt(0).max(1_000_000),
  minOrderAmount: money.nullable().optional(),
  maxUses: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  isActive: z.boolean().optional(),
};
export const couponCreateSchema = z.object({ companyId: z.string().min(1), ...couponFields });
export const couponUpdateSchema = z.object(couponFields).partial();

const COMPANY_REQUIRED = "اختر الشركة لعرض إعدادات المتجر";
const ZONE_NOT_FOUND = "منطقة الشحن غير موجودة";
const ZONE_DUPLICATE = "هذه المدينة مضافة من قبل في مناطق الشحن";
const COUPON_NOT_FOUND = "رمز الخصم غير موجود";
const COUPON_DUPLICATE = "رمز الخصم مستخدم من قبل — اختر رمزاً آخر";
const COUPON_PERCENT_RANGE = "نسبة الخصم يجب أن تكون بين 1 و100";

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

function companyOf(req: Parameters<RequestHandler>[0]) {
  const { companyId } = req.query;
  if (typeof companyId !== "string" || !companyId) throw badRequest(COMPANY_REQUIRED);
  assertCompanyAccess(req.auth!, companyId);
  return companyId;
}

/** الشركة من الجسم يجب أن تكون شركة في مستأجر المستخدم نفسه — companyScope="all" لا يعني شركات مستأجر آخر. */
async function ownCompany(req: Parameters<RequestHandler>[0]) {
  const company = await prisma.company.findFirst({ where: { id: req.body.companyId, tenantId: req.auth!.tenantId }, select: { id: true } });
  if (!company) throw badRequest(COMPANY_REQUIRED);
  return company.id;
}

const zoneOut = (z: { id: string; city: string; fee: Prisma.Decimal; isActive: boolean }) => ({ id: z.id, city: z.city, fee: Number(z.fee), isActive: z.isActive });
const couponOut = (c: Prisma.StoreCouponGetPayload<object>) => ({
  id: c.id, code: c.code, type: c.type, value: Number(c.value), minOrderAmount: c.minOrderAmount == null ? null : Number(c.minOrderAmount),
  maxUses: c.maxUses, usedCount: c.usedCount, expiresAt: c.expiresAt, isActive: c.isActive,
});

const listZones: RequestHandler = async (req, res) => {
  const zones = await prisma.storeShippingZone.findMany({ where: { tenantId: req.auth!.tenantId, companyId: companyOf(req) }, orderBy: { city: "asc" } });
  res.json(zones.map(zoneOut));
};

const createZone: RequestHandler = async (req, res) => {
  const companyId = await ownCompany(req);
  try {
    const zone = await prisma.storeShippingZone.create({ data: { tenantId: req.auth!.tenantId, companyId, city: req.body.city, fee: req.body.fee, isActive: req.body.isActive ?? true } });
    res.status(201).json(zoneOut(zone));
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(ZONE_DUPLICATE);
    throw e;
  }
};

async function ownZone(req: Parameters<RequestHandler>[0]) {
  await assertRecordCompanyScope(req.auth!, prisma.storeShippingZone, req.params.id);
  const zone = await prisma.storeShippingZone.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!zone) throw notFound(ZONE_NOT_FOUND);
  return zone;
}

const updateZone: RequestHandler = async (req, res) => {
  const zone = await ownZone(req);
  try {
    res.json(zoneOut(await prisma.storeShippingZone.update({ where: { id: zone.id }, data: { city: req.body.city, fee: req.body.fee, isActive: req.body.isActive } })));
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(ZONE_DUPLICATE);
    throw e;
  }
};

const deleteZone: RequestHandler = async (req, res) => {
  const zone = await ownZone(req);
  await prisma.storeShippingZone.delete({ where: { id: zone.id } });
  res.status(204).end();
};

const listCoupons: RequestHandler = async (req, res) => {
  const coupons = await prisma.storeCoupon.findMany({ where: { tenantId: req.auth!.tenantId, companyId: companyOf(req) }, orderBy: { createdAt: "desc" } });
  res.json(coupons.map(couponOut));
};

const createCoupon: RequestHandler = async (req, res) => {
  const companyId = await ownCompany(req);
  const { code, type, value, minOrderAmount, maxUses, expiresAt, isActive } = req.body;
  if (type === "percent" && value > 100) throw badRequest(COUPON_PERCENT_RANGE);
  try {
    const coupon = await prisma.storeCoupon.create({ data: { tenantId: req.auth!.tenantId, companyId, code, type, value, minOrderAmount: minOrderAmount ?? null, maxUses: maxUses ?? null, expiresAt: expiresAt ?? null, isActive: isActive ?? true } });
    res.status(201).json(couponOut(coupon));
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(COUPON_DUPLICATE);
    throw e;
  }
};

async function ownCoupon(req: Parameters<RequestHandler>[0]) {
  await assertRecordCompanyScope(req.auth!, prisma.storeCoupon, req.params.id);
  const coupon = await prisma.storeCoupon.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!coupon) throw notFound(COUPON_NOT_FOUND);
  return coupon;
}

const updateCoupon: RequestHandler = async (req, res) => {
  const coupon = await ownCoupon(req);
  const type = req.body.type ?? coupon.type;
  const value = req.body.value ?? Number(coupon.value);
  if (type === "percent" && value > 100) throw badRequest(COUPON_PERCENT_RANGE);
  const { code, minOrderAmount, maxUses, expiresAt, isActive } = req.body;
  try {
    res.json(couponOut(await prisma.storeCoupon.update({ where: { id: coupon.id }, data: { code, type: req.body.type, value: req.body.value, minOrderAmount, maxUses, expiresAt, isActive } })));
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(COUPON_DUPLICATE);
    throw e;
  }
};

const deleteCoupon: RequestHandler = async (req, res) => {
  const coupon = await ownCoupon(req);
  await prisma.storeCoupon.delete({ where: { id: coupon.id } });
  res.status(204).end();
};

export const storeAdminRoutes = Router();
storeAdminRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

// «إدارة الشركات» في مصفوفة المناصب لا تحمل فعل قراءة (كقائمة الشركات نفسها) — القراءة هنا بالدور، والكتابة بالدور والمصفوفة معاً
const canManage = requireRole("admin", "finance_manager");

storeAdminRoutes.get("/shipping-zones", canManage, listZones);
storeAdminRoutes.post("/shipping-zones", requirePositionAction("companySettings", "edit"), canManage, validateBody(shippingZoneCreateSchema), createZone);
storeAdminRoutes.patch("/shipping-zones/:id", requirePositionAction("companySettings", "edit"), canManage, validateBody(shippingZoneUpdateSchema), updateZone);
storeAdminRoutes.delete("/shipping-zones/:id", requirePositionAction("companySettings", "edit"), canManage, deleteZone);

storeAdminRoutes.get("/coupons", canManage, listCoupons);
storeAdminRoutes.post("/coupons", requirePositionAction("companySettings", "create"), canManage, validateBody(couponCreateSchema), createCoupon);
storeAdminRoutes.patch("/coupons/:id", requirePositionAction("companySettings", "edit"), canManage, validateBody(couponUpdateSchema), updateCoupon);
storeAdminRoutes.delete("/coupons/:id", requirePositionAction("companySettings", "edit"), canManage, deleteCoupon);
