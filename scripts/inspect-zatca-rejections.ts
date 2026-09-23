/**
 * سكربت قراءة فقط (read-only) — يطبع الاستجابة الخام الكاملة (zatcaResponseRaw) التي أعادتها
 * زاتكا فعلياً لفواتير شركة معيّنة لم تُقبَل بنجاح (rejected/certificate_error/submission_failed).
 *
 * بخلاف scripts/check-zatca-certificate.ts وscripts/normalize-zatca-certificate.ts: لا يوجد هنا
 * أي سرّ (لا شهادة، لا مفتاح خاص، لا تشفير/فك تشفير على الإطلاق) — zatcaResponseRaw عمود JSON عادي
 * غير مشفَّر، وهو استجابة API عمل تجارية من زاتكا، فيُطبَع كاملاً بلا أي تحفّظ. هذا تحديداً الغرض من
 * هذا السكربت: معرفة الشكل الفعلي الذي تُعيده زاتكا حقيقةً عند الرفض (بخلاف الشكل المفترَض في
 * src/lib/zatca/apiClient.ts، غير المُتحقَّق منه فعلياً وقت كتابته).
 *
 * الاستخدام (من Railway Console، حيث DATABASE_URL مضبوطة فعلياً):
 *
 *   npx tsx scripts/inspect-zatca-rejections.ts <معرّف الشركة الدقيق>
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const NOT_SUCCESSFUL_STATUSES = ["rejected", "certificate_error", "submission_failed"] as const;

async function main() {
  const companyId = process.argv[2];
  if (!companyId) {
    console.error("الاستخدام: npx tsx scripts/inspect-zatca-rejections.ts <معرّف الشركة الدقيق>");
    process.exit(1);
  }

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    console.log("لا توجد شركة بهذا المعرّف الدقيق.");
    return;
  }
  console.log(`[inspect-zatca-rejections.ts] الشركة: "${company.name}" (${company.id})\n`);

  const invoices = await prisma.salesInvoice.findMany({
    where: { companyId, zatcaStatus: { in: [...NOT_SUCCESSFUL_STATUSES] } },
    select: { id: true, invoiceNumber: true, zatcaStatus: true, zatcaSubmittedAt: true, zatcaUuid: true, zatcaResponseRaw: true },
    orderBy: { zatcaSubmittedAt: "desc" },
    take: 20,
  });

  if (!invoices.length) {
    console.log("لا توجد فواتير بحالة رفض/تعذّر توقيع/تعذّر إرسال لهذه الشركة.");
    return;
  }

  for (const inv of invoices) {
    console.log(`=== فاتورة ${inv.invoiceNumber} (id=${inv.id}) — الحالة: ${inv.zatcaStatus} — أُرسلت: ${inv.zatcaSubmittedAt?.toISOString() ?? "—"} ===`);
    console.log(`documentUuid=${inv.zatcaUuid}`);
    if (inv.zatcaResponseRaw === null || inv.zatcaResponseRaw === undefined) {
      console.log("zatcaResponseRaw: (فارغ — لم تُخزَّن أي استجابة، على الأرجح تعذّر توقيع محلي قبل أي اتصال بزاتكا)");
    } else {
      console.log("zatcaResponseRaw:", JSON.stringify(inv.zatcaResponseRaw, null, 2));
    }
    console.log("");
  }
}

main()
  .catch((err) => {
    console.error("خطأ أثناء الفحص:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
