import { Router, RequestHandler } from "express";
import { z } from "zod";
import { authenticate, enforceCompanyScope, blockMutationsWhenReadOnly, requireRole, assertRecordCompanyScope, assertCompanyAccess } from "../../middleware/auth";
import { requirePositionAction } from "../../middleware/positionMatrix";
import { validateBody } from "../../middleware/validate";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";

/**
 * متابعة طلبات المتجر الإلكتروني من داخل أثر (مستخدم مصادَق، ضمن نطاق شركته). الطلب يُنشأ من المتجر العام فقط
 * (src/modules/store)؛ هنا يُقرأ وتُغيَّر حالته. صلاحيته صلاحية فواتير المبيعات: الطلب مرحلة قبل الفاتورة في المبيعات.
 */
const STATUSES = ["new", "confirmed", "completed", "cancelled"] as const;
export const updateStoreOrderStatusSchema = z.object({ status: z.enum(STATUSES) });

const list: RequestHandler = async (req, res) => {
  const { companyId, status } = req.query;
  if (typeof companyId !== "string" || !companyId) throw badRequest("اختر الشركة لعرض طلبات المتجر");
  assertCompanyAccess(req.auth!, companyId);
  const orders = await prisma.storeOrder.findMany({
    where: { tenantId: req.auth!.tenantId, companyId, status: typeof status === "string" && (STATUSES as readonly string[]).includes(status) ? (status as (typeof STATUSES)[number]) : undefined },
    orderBy: { number: "desc" },
    take: 500,
    include: { lines: { orderBy: { id: "asc" } } },
  });
  res.json(orders);
};

const updateStatus: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.storeOrder, req.params.id);
  const existing = await prisma.storeOrder.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("طلب المتجر غير موجود");
  const order = await prisma.storeOrder.update({ where: { id: existing.id }, data: { status: req.body.status }, include: { lines: { orderBy: { id: "asc" } } } });
  res.json(order);
};

export const storeOrderRoutes = Router();
storeOrderRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

storeOrderRoutes.get("/", requirePositionAction("salesInvoices", "read"), list);
storeOrderRoutes.patch("/:id/status", requirePositionAction("salesInvoices", "edit"), requireRole("admin", "finance_manager", "accountant"), validateBody(updateStoreOrderStatusSchema), updateStatus);
