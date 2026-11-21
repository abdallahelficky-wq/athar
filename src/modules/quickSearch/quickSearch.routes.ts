import { Router, type Request, type RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { HttpError, badRequest } from "../../lib/httpError";
import { requirePositionAction } from "../../middleware/positionMatrix";
import { authenticate, enforceCompanyScope, assertCompanyAccess } from "../../middleware/auth";

/**
 * البحث السريع في رأس الشاشة: العملاء والموردون (بالاسم) وفواتير المبيعات والمشتريات (بالرقم) — أول 5 من كل مجموعة،
 * بحث في الخادم بدل تحميل القوائم الأربع كاملة في المتصفح مع كل بحث. كل مجموعة تظهر فقط لمن يملك قراءة وحدتها
 * (نفس requirePositionAction لمسار قائمتها) — كما كان سابقاً حين يفشل طلب القائمة بصمت لمن لا يملكها.
 */
const MAX_PER_GROUP = 5;

const READ_CHECKS = {
  customers: requirePositionAction("customers", "read"),
  suppliers: requirePositionAction("suppliers", "read"),
  salesInvoices: requirePositionAction("salesInvoices", "read"),
  purchaseInvoices: requirePositionAction("purchaseInvoices", "read"),
} satisfies Record<string, RequestHandler>;

/** يشغّل فحص الصلاحية نفسه المستخدَم في مسار القائمة، ويعيد false بدل رفض الطلب كله عند 403 */
async function canRead(req: Request, check: RequestHandler): Promise<boolean> {
  try {
    let passed = false;
    await (check as unknown as (r: Request, s: unknown, n: () => void) => Promise<void>)(req, {}, () => { passed = true; });
    return passed;
  } catch (err) {
    if (err instanceof HttpError && err.status === 403) return false;
    throw err;
  }
}

export const quickSearchRoutes = Router();
quickSearchRoutes.use(authenticate, enforceCompanyScope);

quickSearchRoutes.get("/", async (req, res) => {
  const companyId = typeof req.query.companyId === "string" ? req.query.companyId : "";
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  if (!companyId) throw badRequest("الشركة مطلوبة");
  assertCompanyAccess(req.auth!, companyId);
  const empty = { customers: [], suppliers: [], salesInvoices: [], purchaseInvoices: [] };
  if (q.length < 2) {
    res.json(empty);
    return;
  }
  const tenantId = req.auth!.tenantId;
  const contains = { contains: q, mode: "insensitive" as const };
  const allowed = {
    customers: await canRead(req, READ_CHECKS.customers),
    suppliers: await canRead(req, READ_CHECKS.suppliers),
    salesInvoices: await canRead(req, READ_CHECKS.salesInvoices),
    purchaseInvoices: await canRead(req, READ_CHECKS.purchaseInvoices),
  };
  const [customers, suppliers, salesInvoices, purchaseInvoices] = await Promise.all([
    allowed.customers ? prisma.customer.findMany({ where: { tenantId, companyId, name: contains }, select: { id: true, name: true, accountId: true }, orderBy: { name: "asc" }, take: MAX_PER_GROUP }) : [],
    allowed.suppliers ? prisma.supplier.findMany({ where: { tenantId, companyId, name: contains }, select: { id: true, name: true, accountId: true }, orderBy: { name: "asc" }, take: MAX_PER_GROUP }) : [],
    allowed.salesInvoices ? prisma.salesInvoice.findMany({ where: { tenantId, companyId, invoiceNumber: contains }, select: { id: true, invoiceNumber: true, customer: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: MAX_PER_GROUP }) : [],
    allowed.purchaseInvoices ? prisma.purchaseInvoice.findMany({ where: { tenantId, companyId, invoiceNumber: contains }, select: { id: true, invoiceNumber: true, supplier: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: MAX_PER_GROUP }) : [],
  ]);
  res.json({ customers, suppliers, salesInvoices, purchaseInvoices });
});
