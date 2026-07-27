import { z } from "zod";

// نفس أنواع الكيانات المذكورة صراحة في الطلب — يمكن توسعتها لاحقاً بلا أي تعديل في المخطط
// لأن entityType مخزَّن كـ String حر وليس enum على مستوى قاعدة البيانات (انظر schema.prisma)
export const attachmentEntityTypeEnum = z.enum([
  "company",
  "journal_entry",
  "sales_invoice",
  "sales_return",
  "receipt",
  "purchase_invoice",
  "purchase_return",
  "payroll_run",
  "leave_settlement",
  "fixed_asset",
]);

export const listAttachmentsQuerySchema = z.object({
  entityType: attachmentEntityTypeEnum,
  entityId: z.string().min(1),
});

export const createAttachmentBodySchema = z.object({
  entityType: attachmentEntityTypeEnum,
  entityId: z.string().min(1, "معرّف المعاملة مطلوب"),
});
