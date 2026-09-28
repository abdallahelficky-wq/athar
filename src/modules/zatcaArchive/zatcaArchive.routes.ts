import { Router, RequestHandler } from "express";
import { authenticate, enforceCompanyScope, requireRole, assertCompanyAccess } from "../../middleware/auth";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { exportZatcaArchive, unarchivedSinceArchiving } from "../../lib/zatca/archive";

/**
 * تصدير أرشيف مستندات زاتكا لشركة وفترة (الملحق 1 من قرار الإلزام: قدرة الحل على التصدير إلى نظام أرشفة خارجي، بأسماء
 * ملفات من الرقم الضريبي وتاريخ ووقت الإصدار ورقم المستند). قراءة فقط — الأرشيف نفسه لا يُعدَّل من أي مسار.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const exportHandler: RequestHandler = async (req, res) => {
  const { companyId, from, to } = req.query;
  if (typeof companyId !== "string" || !companyId) throw badRequest("حدد الشركة");
  if (typeof from !== "string" || typeof to !== "string" || !DAY.test(from) || !DAY.test(to)) throw badRequest("حدد الفترة (من، إلى) بصيغة YYYY-MM-DD");
  const start = new Date(`${from}T00:00:00.000Z`);
  const endExclusive = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000);
  if (start >= endExclusive) throw badRequest("بداية الفترة بعد نهايتها");
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId: req.auth!.tenantId }, select: { id: true, vatNumber: true } });
  if (!company) throw notFound("الشركة غير موجودة");
  assertCompanyAccess(req.auth!, company.id);

  const result = await exportZatcaArchive(req.auth!.tenantId, company.id, start, endExclusive);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="zatca-archive_${company.vatNumber ?? company.id}_${from}_${to}.zip"`);
  res.setHeader("X-Archived-Count", String(result.archivedCount));
  res.setHeader("X-Missing-Count", String(result.missingCount));
  res.setHeader("Access-Control-Expose-Headers", "X-Archived-Count, X-Missing-Count, Content-Disposition");
  res.send(result.zip);
};

/** عدد المستندات المقبولة منذ بدء الأرشفة بلا أصل محفوظ — يجب أن يكون صفراً (راجع unarchivedSinceArchiving) */
const unarchivedHandler: RequestHandler = async (req, res) => {
  const companyId = typeof req.query.companyId === "string" && req.query.companyId ? req.query.companyId : undefined;
  if (companyId) assertCompanyAccess(req.auth!, companyId);
  else if (req.auth!.companyScope !== "all") throw badRequest("حدد الشركة");
  res.json(await unarchivedSinceArchiving(req.auth!.tenantId, companyId));
};

export const zatcaArchiveRoutes = Router();
zatcaArchiveRoutes.use(authenticate, enforceCompanyScope);
zatcaArchiveRoutes.get("/export", requireRole("admin", "finance_manager", "accountant"), exportHandler);
zatcaArchiveRoutes.get("/unarchived", unarchivedHandler);
