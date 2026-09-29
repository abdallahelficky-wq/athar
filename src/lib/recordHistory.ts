import { prisma } from "./prisma";

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
