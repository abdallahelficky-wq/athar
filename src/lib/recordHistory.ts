import type { RequestHandler } from "express";
import { prisma } from "./prisma";
import { assertCompanyAccess } from "../middleware/auth";

/**
 * سجل تاريخ السجلات — مبني على audit_logs (نسخة اسم المنفّذ وبريده محفوظة لحظة الكتابة، #111). القطعة الأولى: المُنشئ.
 * صف الإنشاء يكتبه مُشغِّل في قاعدة البيانات لكل قيد (journal_entry_record_created)، فيغطّي كل مسارات الإنشاء.
 *
 * provenance: "recorded" = كُتب لحظة الإنشاء؛ "backfilled" = أُعيد بناؤه لاحقاً من createdBy/createdAt والاسم هو اسم
 * المستخدم وقت الاستكمال. ادّعاءان مختلفان أمام المدقق — شاشة سجل التاريخ تُظهر الفرق، والسند المطبوع لا يحتاجه.
 * name = null يعني أن النظام لا يحمل المُنشئ (createdBy فارغ أو يشير إلى مستخدم غير موجود) — يُعرَض «غير مسجَّل».
 */
export type RecordProvenance = "recorded" | "backfilled";
export interface RecordCreator {
  name: string | null;
  at: Date;
  provenance: RecordProvenance;
}

export async function getRecordCreator(tenantId: string, entityType: "JournalEntry", entityId: string): Promise<RecordCreator | null> {
  const row = await prisma.auditLog.findFirst({
    where: { tenantId, entityType, entityId, action: "journal_entry.created" },
    orderBy: { createdAt: "asc" },
    select: { actorName: true, createdAt: true, metadata: true },
  });
  if (!row) return null;
  const provenance = (row.metadata as { provenance?: string } | null)?.provenance === "recorded" ? "recorded" : "backfilled";
  return { name: row.actorName ?? null, at: row.createdAt, provenance };
}

/**
 * سجل تعديلات مستند/سجل كامل (record_row_change وغيرها): من فعل ماذا ومتى، الأحدث أولاً. محصور في مستأجر الطلب،
 * وفي شركات نطاق المستخدم: كل صفوف السجل الواحد تحمل companyId شركته، فيُرفض الطلب لو كانت خارج النطاق.
 * الصفوف القديمة قبل المُشغِّل (أو بلا منفّذ) تُعرَض بلا اسم — «غير مسجَّل» — لا تُنسَب لأحد.
 */
export type HistoryEntityType =
  | "SalesInvoice" | "PurchaseInvoice" | "SalesReturn" | "PurchaseReturn" | "SalesDebitNote"
  | "Receipt" | "Customer" | "Supplier" | "Item";

export async function listRecordHistory(tenantId: string, entityType: HistoryEntityType, entityId: string) {
  return prisma.auditLog.findMany({
    where: { tenantId, entityType, entityId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 500,
    select: { id: true, action: true, actorName: true, actorEmail: true, createdAt: true, metadata: true, companyId: true },
  });
}

export function recordHistoryHandler(entityType: HistoryEntityType): RequestHandler {
  return async (req, res) => {
    const rows = await listRecordHistory(req.auth!.tenantId, entityType, req.params.id);
    const companyIds = new Set<string>();
    for (const row of rows) if (row.companyId) companyIds.add(row.companyId as string);
    for (const companyId of companyIds) assertCompanyAccess(req.auth!, companyId);
    res.json(rows.map(({ companyId: _companyId, ...row }) => row));
  };
}
