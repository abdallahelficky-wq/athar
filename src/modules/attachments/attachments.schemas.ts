import { z } from "zod";

// نفس أنواع الكيانات المذكورة صراحة في الطلب — يمكن توسعتها لاحقاً بلا أي تعديل في المخطط
// لأن entityType مخزَّن كـ String حر وليس enum على مستوى قاعدة البيانات (انظر schema.prisma)
export const attachmentEntityTypeEnum = z.enum([
  "company",
  "customer",
  "journal_entry",
  "sales_invoice",
  "sales_return",
  "receipt",
  "purchase_invoice",
  "purchase_return",
  "payroll_run",
  "leave_settlement",
  "fixed_asset",
  "employee",
  "station_shift_reading",
  "station_shift_expense",
  // صور المنتج في المتجر الإلكتروني العام — النوع الوحيد الذي يُعرَض للعموم (لصنف منشور فقط، راجع store.service.ts)
  "item_store_image",
  // بانرات الصفحة الرئيسية للمتجر — entityId هو الشركة، وتُعرَض للعموم ما دام متجرها مفعَّلاً
  "store_banner",
]);

export const listAttachmentsQuerySchema = z.object({
  entityType: attachmentEntityTypeEnum,
  entityId: z.string().min(1),
});

export const createAttachmentBodySchema = z.object({
  entityType: attachmentEntityTypeEnum,
  entityId: z.string().min(1, "معرّف المعاملة مطلوب"),
});
