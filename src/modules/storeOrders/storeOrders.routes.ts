import { Router, RequestHandler } from "express";
import { z } from "zod";
import { authenticate, enforceCompanyScope, blockMutationsWhenReadOnly, requireRole, assertRecordCompanyScope, assertCompanyAccess } from "../../middleware/auth";
import { requirePositionAction } from "../../middleware/positionMatrix";
import { validateBody } from "../../middleware/validate";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { createInvoiceFromStoreOrder } from "./storeOrderInvoice.service";

/**
 * متابعة طلبات المتجر الإلكتروني من داخل أثر (مستخدم مصادَق، ضمن نطاق شركته). الطلب يُنشأ من المتجر العام فقط
 * (src/modules/store)؛ هنا يُقرأ وتُغيَّر حالته. صلاحيته صلاحية فواتير المبيعات: الطلب مرحلة قبل الفاتورة في المبيعات.
 */
const STATUSES = ["new", "confirmed", "completed", "cancelled"] as const;
export const updateStoreOrderStatusSchema = z.object({ status: z.enum(STATUSES) });
export const createStoreOrderInvoiceSchema = z.object({ shippingAccountId: z.string().min(1).nullable().optional() });

// الفاتورة الصادرة من الطلب — رقمها وحالتها فقط، لعرض الربط في قائمة الطلبات
const ORDER_INCLUDE = { lines: { orderBy: { id: "asc" as const } }, salesInvoice: { select: { id: true, invoiceNumber: true, status: true } } };

const list: RequestHandler = async (req, res) => {
  const { companyId, status } = req.query;
  if (typeof companyId !== "string" || !companyId) throw badRequest("اختر الشركة لعرض طلبات المتجر");
  assertCompanyAccess(req.auth!, companyId);
  const orders = await prisma.storeOrder.findMany({
    where: { tenantId: req.auth!.tenantId, companyId, status: typeof status === "string" && (STATUSES as readonly string[]).includes(status) ? (status as (typeof STATUSES)[number]) : undefined },
    orderBy: { number: "desc" },
    take: 500,
    include: ORDER_INCLUDE,
  });
  res.json(orders);
};

const updateStatus: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.storeOrder, req.params.id);
  const existing = await prisma.storeOrder.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("طلب المتجر غير موجود");
  const order = await prisma.storeOrder.update({ where: { id: existing.id }, data: { status: req.body.status }, include: ORDER_INCLUDE });
  res.json(order);
};

/** إصدار فاتورة مبيعات (مسودة) من الطلب — راجع storeOrderInvoice.service.ts */
const createInvoice: RequestHandler = async (req, res) => {
  await assertRecordCompanyScope(req.auth!, prisma.storeOrder, req.params.id);
  const result = await createInvoiceFromStoreOrder(req.auth!.tenantId, req.auth!.sub, req.params.id, req.body);
  const order = await prisma.storeOrder.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId }, include: ORDER_INCLUDE });
  res.status(201).json({ ...result, order });
};

export const storeOrderRoutes = Router();
storeOrderRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

storeOrderRoutes.get("/", requirePositionAction("salesInvoices", "read"), list);
storeOrderRoutes.patch("/:id/status", requirePositionAction("salesInvoices", "edit"), requireRole("admin", "finance_manager", "accountant"), validateBody(updateStoreOrderStatusSchema), updateStatus);
storeOrderRoutes.post("/:id/invoice", requirePositionAction("salesInvoices", "create"), requireRole("admin", "finance_manager", "accountant"), validateBody(createStoreOrderInvoiceSchema), createInvoice);
