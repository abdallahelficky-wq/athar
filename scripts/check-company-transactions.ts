/**
 * سكربت قراءة فقط (read-only) — لا يعدّل أي بيانات.
 * يتحقق مما إذا كان لشركة معينة (بالاسم أو بمعرّفها الدقيق) أي معاملات حقيقية مرحّلة على شجرة
 * حساباتها الحالية، ويطبع أيضاً القائمة الكاملة للحسابات المُثبَّتة فعلياً في شجرتها حالياً
 * (بعد أي "تثبيت شجرة قياسية" سابق) — لتأكيد حقيقي على الإنتاج قبل اتخاذ أي قرار لاحق (مقارنة
 * مع ملف قديم، إضافة حسابات مخصصة، إلخ).
 *
 * الاستخدام:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/check-company-transactions.ts "تيسم برو"
 *   DATABASE_URL="postgresql://..." npx tsx scripts/check-company-transactions.ts cms3fplst000dxuo7tj093pif
 *
 * المعامل الوحيد يُفسَّر أولاً كمعرّف شركة دقيق (id)؛ لو لم يُطابق أي شركة، يُعاد المحاولة كبحث
 * جزئي بالاسم (كالسابق) — حتى لا يُكسَر أي استخدام سابق بالاسم.
 *
 * لا يقوم بأي عملية DELETE/UPDATE/INSERT — فقط استعلامات SELECT/COUNT.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const query = process.argv[2];
  if (!query) {
    console.error("الاستخدام: npx tsx scripts/check-company-transactions.ts \"اسم الشركة أو معرّفها\"");
    process.exit(1);
  }

  // بصمة تشغيل صريحة — لإزالة أي لبس بشأن هل النسخة المُنفَّذة فعلياً هي أحدث نسخة من هذا الملف
  // (تسبَّبت نسخة قديمة مُشغَّلة من مسار/جلسة أخرى في التباس سابق حول هذه النقطة تحديداً).
  console.log(`[check-company-transactions.ts] cwd=${process.cwd()} arg="${query}"`);

  // findUnique تُرجع null طبيعياً لو لم يوجد id مطابق — لا حاجة لالتقاط أي استثناء هنا؛ أي خطأ فعلي
  // (اتصال قاعدة البيانات، صلاحيات، إلخ) يجب أن يظهر بوضوح لا أن يُبتلَع ويُعامَل كـ"لم يوجد بالاسم".
  const byId = await prisma.company.findUnique({
    where: { id: query },
    select: { id: true, tenantId: true, name: true, shortName: true },
  });
  console.log(`[check-company-transactions.ts] بحث بالمعرّف الدقيق: ${byId ? `وُجدت مطابقة (${byId.name})` : "لا توجد مطابقة — التحويل للبحث بالاسم"}`);

  const companies = byId
    ? [byId]
    : await prisma.company.findMany({
        where: { name: { contains: query } },
        select: { id: true, tenantId: true, name: true, shortName: true },
      });

  if (companies.length === 0) {
    console.log(`لم يتم العثور على أي شركة بمعرّف أو باسم يحتوي على "${query}".`);
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

    const accountList = await prisma.account.findMany({
      where: { companyId: company.id },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, type: true, level: true, isPosting: true, parentId: true, isArchived: true },
    });
    // parentId مُخزَّن كمعرّف داخلي لا كـcode — نستبدله بكود الأب (parentCode) الأوضح للمراجعة اليدوية.
    const codeById = new Map(accountList.map((a) => [a.id, a.code]));
    const accountRows = accountList.map((a) => ({
      code: a.code,
      name: a.name,
      type: a.type,
      level: a.level,
      isPosting: a.isPosting,
      parentCode: a.parentId ? codeById.get(a.parentId) ?? "?" : null,
      isArchived: a.isArchived,
    }));

    console.log({
      accountsInTree: accountList.length,
      postingLevel4Accounts: accountList.filter((a) => a.level === 4 && a.isPosting).length,
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

    console.log(`\nالقائمة الكاملة للحسابات المُثبَّتة فعلياً (${accountRows.length} حساب) — بترتيب الكود:`);
    console.table(accountRows);

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
