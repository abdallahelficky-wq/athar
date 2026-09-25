import { Prisma } from "@prisma/client";

/**
 * نفس التصنيف الرباعي المعروض في شاشات الفواتير/المردودات (راجع invoiceZatcaState.js بالواجهة)
 * مبنيّاً هنا بـSQL مباشرة — sent/sent_with_notes مبنيّتان من zatcaStatus وتحذيرات zatcaResponseRaw
 * (validationResults.warningMessages) معاً، بنفس منطق الواجهة الحالي تماماً. jsonb_typeof يحمي من
 * أي قيمة غير مصفوفة أو غائبة (يُعيد NULL بدل رمي خطأ)، فتُقيَّم كـ"بلا تحذيرات" بأمان.
 *
 * مُشترَكة بين أي جدول يحمل عمودي zatcaStatus/zatcaResponseRaw بنفس الشكل (SalesInvoice،
 * SalesReturn...) — alias اسم الجدول في الاستعلام (مثلاً "si"/"sr") قيمة ثابتة يضبطها الكود نفسه
 * دائماً (ليست مُدخَلاً خارجياً من المستخدم بأي حال)، فحقنها عبر Prisma.raw هنا آمن تماماً.
 */
export function zatcaGroupExpr(tableAlias: string): Prisma.Sql {
  const t = Prisma.raw(`"${tableAlias}"`);
  return Prisma.sql`
    CASE
      WHEN ${t}."zatcaStatus" IN ('cleared', 'reported') THEN
        CASE WHEN jsonb_typeof(${t}."zatcaResponseRaw"->'validationResults'->'warningMessages') = 'array'
          AND jsonb_array_length(${t}."zatcaResponseRaw"->'validationResults'->'warningMessages') > 0
          THEN 'sent_with_notes' ELSE 'sent' END
      WHEN ${t}."zatcaStatus" = 'not_applicable' THEN 'not_applicable'
      ELSE 'not_sent'
    END
  `;
}
