import { z } from "zod";

/**
 * صف واحد بعد التطبيع من الملف المرفوع (Excel/CSV) — يُطبَّع في الواجهة الأمامية من أعمدة الملف
 * العربية الحرة (قد تختلف صياغتها قليلاً) إلى هذا الشكل الثابت، فلا يحتاج الخادم معرفة أسماء
 * أعمدة أي ملف مصدر بعينه، ويبقى قابلاً لإعادة الاستخدام لأي عملية استيراد تاريخية مستقبلية.
 */
export const bulkImportRowSchema = z.object({
  groupKey: z.string().min(1, "رقم القيد التسلسلي مطلوب لكل صف"),
  date: z.string().min(1, "التاريخ مطلوب لكل صف"),
  memo: z.string().optional().default(""),
  accountName: z.string().min(1, "اسم الحساب مطلوب لكل صف"),
  debit: z.coerce.number().min(0).default(0),
  credit: z.coerce.number().min(0).default(0),
  note: z.string().optional().default(""),
});

export const previewBulkImportSchema = z.object({
  companyId: z.string().min(1, "اختر شركة محددة أولاً"),
  rows: z.array(bulkImportRowSchema).min(1, "الملف فارغ").max(20000, "عدد الأسطر أكبر من الحد المسموح لعملية استيراد واحدة"),
});

export const commitBulkImportSchema = previewBulkImportSchema.extend({
  // اسم الحساب في الملف -> معرّف الحساب الفعلي في شجرة الشركة (بعد مراجعة المستخدم للمطابقة التلقائية)
  accountMapping: z.record(z.string(), z.string().min(1)),
});
