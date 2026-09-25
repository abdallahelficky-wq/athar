/**
 * سكربت استيراد فواتير مبيعات "خلَّصتها زاتكا فعلياً لدى زاتكا نفسها، لكن ضاعت قبل أن تُحفَظ في
 * قاعدتنا" (حادثة [zatcaChainGap]، 2026-09-21) — يقرأ ملف JSON يحوي مستندات زاتكا الحقيقية
 * (مطابَقة يدوياً مسبقاً مع سجلات زاتكا) ويستدعي importClearedSalesInvoice لكل مستند على حدة، كل
 * مستند بمعاملته الخاصة (فشل مستند واحد لا يُسقِط بقية المستندات).
 *
 * لا اتصال بزاتكا هنا إطلاقاً بأي شكل — راجع تعليق src/modules/salesInvoices/importClearedSalesInvoice.ts
 * لتفاصيل الضمانة. هذا السكربت هو الاستخدام الوحيد المقصود لتلك الدالة: لا نقطة نهاية HTTP توجد أو
 * يجب أن تُضاف لها — الاستيراد فعل استثنائي يدوي بعد مطابقة سجلات زاتكا يدوياً، لا عملية تطبيق عادية.
 *
 * وضع المعاينة (dry-run) هو الافتراضي دائماً: يتحقّق من كل مستند (اتساق المبالغ، وجود العميل/
 * الحسابات/الأصناف، كفاية المخزون، عدم تكرار رقم الفاتورة/zatcaUuid/icv) ويطبع ما كان سيُنشئه، بلا
 * أي كتابة لقاعدة البيانات إطلاقاً. لا يُكتَب شيء فعلياً إلا بعلم --apply صريح.
 *
 * شكل ملف الإدخال (JSON):
 * {
 *   "tenantId": "...",
 *   "userId": "...",              // من نفّذ الاستيراد فعلياً — يُسجَّل في القيد المحاسبي وسجل التدقيق
 *   "documents": [
 *     {
 *       "companyId": "...", "customerId": "...",
 *       "invoiceNumber": "INV-2026-00931", "date": "2026-09-21",
 *       "zatcaUuid": "....", "icv": 933,
 *       "previousInvoiceHash": "...", "invoiceHash": "...",
 *       "zatcaClearedOrReportedAt": "2026-09-21T10:15:00Z",   // اختياري، يُفترَض date افتراضياً
 *       "reason": "استيراد فاتورة خلَّصتها زاتكا فعلياً وضاعت قبل الحفظ — حادثة [zatcaChainGap]",
 *       "subtotal": 1000, "vatTotal": 150, "grandTotal": 1150,
 *       "lines": [
 *         { "accountId": "...", "itemId": null, "description": "...", "quantity": 1,
 *           "unitPrice": 1000, "discountPct": 0, "priceIncludesVat": false, "vatApplicable": true,
 *           "subtotal": 1000, "vat": 150, "total": 1150 }
 *       ]
 *     }
 *   ]
 * }
 *
 * الاستخدام (معاينة فقط، الافتراضي — لا يكتب شيئاً):
 *   npx tsx scripts/importClearedInvoices.ts <path-to-file.json>
 *
 * الاستخدام (تنفيذ فعلي بعد التأكد من نتيجة المعاينة):
 *   npx tsx scripts/importClearedInvoices.ts <path-to-file.json> --apply
 */
import { readFileSync } from "fs";
import { prisma } from "../src/lib/prisma";
import { importClearedSalesInvoice, ImportClearedInvoiceInput } from "../src/modules/salesInvoices/importClearedSalesInvoice";

interface ImportFile {
  tenantId: string;
  userId: string;
  documents: Array<Omit<ImportClearedInvoiceInput, "date" | "zatcaClearedOrReportedAt"> & {
    date: string;
    zatcaClearedOrReportedAt?: string;
  }>;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const filePath = args.find((a) => !a.startsWith("--"));
  if (!filePath) {
    console.error("الاستخدام: npx tsx scripts/importClearedInvoices.ts <path-to-file.json> [--apply]");
    process.exit(1);
  }
  return { filePath, apply };
}

function loadImportFile(filePath: string): ImportFile {
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as ImportFile;
  if (!parsed.tenantId || !parsed.userId || !Array.isArray(parsed.documents) || parsed.documents.length === 0) {
    throw new Error('ملف الإدخال يجب أن يحتوي على "tenantId" و"userId" و"documents" (مصفوفة غير فارغة)');
  }
  return parsed;
}

async function main() {
  const { filePath, apply } = parseArgs();
  const file = loadImportFile(filePath);

  console.log(`ملف الإدخال: ${filePath}`);
  console.log(`عدد المستندات: ${file.documents.length}`);
  console.log(apply ? "الوضع: تنفيذ فعلي (--apply) — سيُكتَب كل مستند صالح فعلياً." : "الوضع: معاينة فقط (dry-run) — لن يُكتَب أي شيء. أضف --apply للتنفيذ الفعلي بعد مراجعة هذا التقرير.");
  console.log("");

  let succeeded = 0;
  let failed = 0;

  for (const [index, doc] of file.documents.entries()) {
    const label = `[${index + 1}/${file.documents.length}] ${doc.invoiceNumber}`;
    const input: ImportClearedInvoiceInput = {
      ...doc,
      date: new Date(doc.date),
      zatcaClearedOrReportedAt: doc.zatcaClearedOrReportedAt ? new Date(doc.zatcaClearedOrReportedAt) : undefined,
    };
    try {
      const result = await importClearedSalesInvoice(file.tenantId, file.userId, input, { dryRun: !apply });
      if ("dryRun" in result) {
        console.log(`${label} — صالح (معاينة فقط): سيُنشئ فاتورة "${result.wouldCreate.invoiceNumber}" للعميل "${result.wouldCreate.customerName}"، ${result.wouldCreate.linesCount} سطر/أسطر، الإجمالي ${result.wouldCreate.grandTotal.toFixed(2)}، النوع ${result.wouldCreate.invoiceType} (${result.wouldCreate.zatcaStatus}).`);
      } else {
        console.log(`${label} — تم الإنشاء فعلياً: id=${result.id}, invoiceNumber=${result.invoiceNumber}, journalEntryId=${result.journalEntryId}, zatcaStatus=${result.zatcaStatus}.`);
      }
      succeeded += 1;
    } catch (err) {
      console.error(`${label} — فشل: ${err instanceof Error ? err.message : String(err)}`);
      failed += 1;
    }
  }

  console.log("");
  console.log(`الخلاصة: ${succeeded} نجح، ${failed} فشل، من أصل ${file.documents.length}.`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("خطأ غير متوقَّع أثناء تنفيذ السكربت:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
