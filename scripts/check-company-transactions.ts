/**
 * سكربت قراءة فقط (read-only) — لا يعدّل أي بيانات.
 * يتحقق مما إذا كان لشركة معينة (بالاسم) أي معاملات حقيقية مرحّلة على شجرة حساباتها الحالية،
 * قبل اتخاذ أي قرار بمسح الشجرة واستبدالها بالقالب القياسي عبر "تثبيت الشجرة القياسية".
 *
 * الاستخدام:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/check-company-transactions.ts "تيسم برو"
 *
 * لا يقوم بأي عملية DELETE/UPDATE/INSERT — فقط استعلامات SELECT/COUNT.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const companyName = process.argv[2];
  if (!companyName) {
    console.error("الاستخدام: npx tsx scripts/check-company-transactions.ts \"اسم الشركة\"");
    process.exit(1);
  }

  const companies = await prisma.company.findMany({
    where: { name: { contains: companyName } },
    select: { id: true, tenantId: true, name: true, shortName: true },
  });

  if (companies.length === 0) {
    console.log(`لم يتم العثور على أي شركة باسم يحتوي على "${companyName}".`);
    return;
  }

  for (const company of companies) {
    console.log(`\n=== الشركة: ${company.name} (${company.shortName || "-"}) — id=${company.id} tenantId=${company.tenantId} ===`);

    const [
      journalLines,
      salesInvoices,
      purchaseInvoices,
      receipts,
      salesReturns,
      purchaseReturns,
      stockMovements,
      fixedAssets,
      payrollRuns,
      depreciationRuns,
    ] = await Promise.all([
      prisma.journalEntryLine.count({ where: { journalEntry: { companyId: company.id } } }),
      prisma.salesInvoice.count({ where: { companyId: company.id } }),
      prisma.purchaseInvoice.count({ where: { companyId: company.id } }),
      prisma.receipt.count({ where: { companyId: company.id } }),
      prisma.salesReturn.count({ where: { companyId: company.id } }),
      prisma.purchaseReturn.count({ where: { companyId: company.id } }),
      prisma.stockMovement.count({ where: { companyId: company.id } }),
      prisma.fixedAsset.count({ where: { companyId: company.id } }),
      prisma.payrollRun.count({ where: { companyId: company.id } }),
      prisma.depreciationRun.count({ where: { companyId: company.id } }),
    ]);

    const accounts = await prisma.account.count({ where: { companyId: company.id } });

    console.log({
      accountsInTree: accounts,
      journalEntryLines: journalLines,
      salesInvoices,
      purchaseInvoices,
      receipts,
      salesReturns,
      purchaseReturns,
      stockMovements,
      fixedAssets,
      payrollRuns,
      depreciationRuns,
    });

    const totalActivity = journalLines + salesInvoices + purchaseInvoices + receipts + salesReturns
      + purchaseReturns + stockMovements + fixedAssets + payrollRuns + depreciationRuns;

    if (totalActivity > 0) {
      console.log(`⚠️  توجد معاملات حقيقية مرتبطة بهذه الشركة (إجمالي ${totalActivity} سجلاً). لا يُنصح بتثبيت الشجرة القياسية دون مراجعة تفصيلية أولاً.`);

      if (journalLines > 0) {
        const sample = await prisma.journalEntryLine.findMany({
          where: { journalEntry: { companyId: company.id } },
          take: 10,
          orderBy: { id: "desc" },
          select: {
            id: true,
            debit: true,
            credit: true,
            account: { select: { code: true, name: true } },
            journalEntry: { select: { entryNumber: true, date: true, status: true } },
          },
        });
        console.log("عينة من آخر 10 بنود قيود مرحّلة على حسابات هذه الشركة:");
        console.log(sample);
      }
    } else {
      console.log("✅ لا توجد أي معاملات مرتبطة بهذه الشركة — الشجرة الحالية تحتوي فقط على حسابات دون حركة.");
    }
  }
}

main()
  .catch((err) => {
    console.error("خطأ أثناء تنفيذ الفحص:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
