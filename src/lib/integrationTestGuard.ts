/**
 * حارس سلامة إلزامي لكل ملف اختبار "تكامل" حقيقي يكتب فعلياً في قاعدة بيانات Postgres حية (لا
 * Prisma مُموَّهة كبقية اختبارات هذا المستودع) — راجع salesInvoicesSearch.integration.test.ts.
 * يجب استدعاؤه كأول سطر تنفيذي في الملف، خارج أي describe/beforeAll، حتى يُقيَّم فوراً لحظة تحميل
 * الملف (قبل أي prisma.*.create فعلي) لا لحظة تشغيل أول اختبار. اختبار تكامل يُنشئ/يحذف مستأجرين
 * وشركات وفواتير حقيقية بالجملة — تشغيله بالخطأ ضد قاعدة بيانات إنتاج فعلية (Neon أو غيرها) كارثة
 * لا رجعة فيها؛ هذا الفحص خط الدفاع الأخير قبل أي كتابة، لا بديلاً عن ضبط DATABASE_URL الصحيح.
 */
export function guardAgainstUnsafeIntegrationTestDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (databaseUrl.includes("neon.tech")) {
    throw new Error(
      "رُفض تشغيل اختبار التكامل: DATABASE_URL يشير إلى مضيف Neon (\"neon.tech\") — قد تكون قاعدة بيانات إنتاج فعلية. " +
        "اختبارات التكامل تكتب/تحذف بيانات فعلية ولا يجوز تشغيلها إلا ضد قاعدة بيانات تطوير/CI محلية معزولة.",
    );
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "رُفض تشغيل اختبار التكامل: NODE_ENV=production — اختبارات التكامل تكتب/تحذف بيانات فعلية ولا يجوز " +
        "تشغيلها إلا في بيئة تطوير/اختبار.",
    );
  }
}
