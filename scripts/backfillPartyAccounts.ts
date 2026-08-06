/**
 * تعبئة رجعية لحسابات العملاء/الموردين/الموظفين المستقلة (partyAccounts.ts) للأطراف الموجودة
 * بالفعل قبل هذه الميزة، وإعادة تصنيف أسطر القيود القديمة المرتبطة بها من الحساب المشترك القديم
 * إلى الحساب المستقل الجديد — بلا أي تغيير على المبالغ أو التواريخ، فقط إعادة تصنيف الحساب المرجعي.
 *
 * الاستخدام:
 *   npx tsx scripts/backfillPartyAccounts.ts                # تقرير Dry-run فقط (لا يعدّل شيئاً)
 *   npx tsx scripts/backfillPartyAccounts.ts --commit        # تنفيذ فعلي بعد مراجعة التقرير أعلاه
 *
 * لا يُشغَّل بعلامة --commit على بيانات إنتاج حقيقية إلا بعد عرض تقرير الـ Dry-run على المستخدم
 * وانتظار تأكيده الصريح.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { ensurePartyAccount, PartyKind } from "../src/lib/partyAccounts";
import { getAccountIdByName } from "../src/lib/wellKnownAccounts";

const prisma = new PrismaClient();
const commit = process.argv.includes("--commit");

// الأسماء المشتركة القديمة التي ترحّلت عليها كل الأطراف قبل هذه الميزة — تُستخدَم فقط لتحديد
// أي أسطر قيود سابقة تخص كل نوع طرف، لإعادة تصنيفها. الرواتب لها اسمان قديمان (كشف الرواتب
// وتسويات الإجازات) لأن كليهما كان يترحّل على حساب "ذمم الموظفين" المشترك السابق قبل Phase G.
const OLD_SHARED_ACCOUNT_NAMES: Record<PartyKind, string[]> = {
  customer: ["ذمم مدينة"],
  supplier: ["ذمم دائنة - موردين"],
  employee: ["رواتب مستحقة للصرف", "ذمم الموظفين - مستحقات وإجازات"],
};

interface PartyReport {
  kind: PartyKind;
  companyId: string;
  companyName: string;
  missingAccount: number;
  reclassifiableLines: number;
  suspiciousLines: number;
}

async function resolveOldSharedAccountIds(tenantId: string, companyId: string, kind: PartyKind): Promise<string[]> {
  const ids: string[] = [];
  for (const name of OLD_SHARED_ACCOUNT_NAMES[kind]) {
    try {
      ids.push(await getAccountIdByName(tenantId, companyId, name));
    } catch {
      // الحساب المشترك بهذا الاسم غير موجود في شجرة هذه الشركة تحديداً (قالب مختلف) — تجاهل بأمان
    }
  }
  return ids;
}

/**
 * ملاحظة أمان مهمة: journalEntries.service.ts لا يتحقق اليوم أن customerId/supplierId/employeeId
 * الموسوم على سطر قيد ينتمي لنفس الشركة الظاهرة على القيد نفسه — أي وسم قديم قد يكون خاطئاً (طرف
 * من شركة أخرى بنفس المستأجر). لذلك: أي سطر بعلامة طرف لا تنتمي فعلياً لشركة القيد يُصنَّف "مشكوك
 * فيه" ولا يُعاد تصنيفه أبداً، حتى في وضع --commit.
 */
async function reportForKind(
  tenantId: string,
  companyId: string,
  companyName: string,
  kind: PartyKind,
): Promise<PartyReport> {
  const table = kind === "customer" ? prisma.customer : kind === "supplier" ? prisma.supplier : prisma.employee;
  const parties = await (table as any).findMany({ where: { tenantId, companyId }, select: { id: true, accountId: true } });
  const missingAccount = parties.filter((p: { accountId: string | null }) => !p.accountId).length;

  const oldAccountIds = await resolveOldSharedAccountIds(tenantId, companyId, kind);
  const tagField = kind === "customer" ? "customerId" : kind === "supplier" ? "supplierId" : "employeeId";

  let reclassifiableLines = 0;
  let suspiciousLines = 0;
  if (oldAccountIds.length) {
    const lines = await prisma.journalEntryLine.findMany({
      where: { accountId: { in: oldAccountIds }, [tagField]: { not: null } } as Prisma.JournalEntryLineWhereInput,
      select: { [tagField]: true, journalEntry: { select: { companyId: true } } } as any,
    });
    const partyIds = new Set(parties.map((p: { id: string }) => p.id));
    for (const line of lines as any[]) {
      const partyId = line[tagField] as string;
      const lineCompanyId = line.journalEntry.companyId;
      if (lineCompanyId !== companyId) { suspiciousLines += 1; continue; }
      if (!partyIds.has(partyId)) { suspiciousLines += 1; continue; }
      reclassifiableLines += 1;
    }
  }

  return { kind, companyId, companyName, missingAccount, reclassifiableLines, suspiciousLines };
}

async function commitForCompany(tenantId: string, companyId: string, companyName: string) {
  for (const kind of ["customer", "supplier", "employee"] as PartyKind[]) {
    const table = kind === "customer" ? "customer" : kind === "supplier" ? "supplier" : "employee";
    const tagField = kind === "customer" ? "customerId" : kind === "supplier" ? "supplierId" : "employeeId";
    const parties: Array<{ id: string; name: string; accountId: string | null }> = await (prisma as any)[table].findMany({
      where: { tenantId, companyId },
      select: { id: true, name: true, accountId: true },
    });
    const oldAccountIds = await resolveOldSharedAccountIds(tenantId, companyId, kind);

    for (const party of parties) {
      if (party.accountId) continue;
      await prisma.$transaction(async (tx) => {
        const { accountId } = await ensurePartyAccount(tx, { tenantId, companyId, kind, partyName: party.name });
        await (tx as any)[table].update({ where: { id: party.id }, data: { accountId } });

        if (oldAccountIds.length) {
          await tx.journalEntryLine.updateMany({
            where: {
              accountId: { in: oldAccountIds },
              [tagField]: party.id,
              journalEntry: { companyId },
            } as Prisma.JournalEntryLineWhereInput,
            data: { accountId },
          });
        }
      });
      console.log(`  ✅ ${kind} "${party.name}" (${companyName}) — تم إنشاء حسابه وإعادة تصنيف قيوده`);
    }
  }
}

async function main() {
  const companies = await prisma.company.findMany({ select: { id: true, tenantId: true, name: true } });
  const reports: PartyReport[] = [];

  for (const company of companies) {
    for (const kind of ["customer", "supplier", "employee"] as PartyKind[]) {
      reports.push(await reportForKind(company.tenantId, company.id, company.name, kind));
    }
  }

  const relevant = reports.filter((r) => r.missingAccount > 0 || r.reclassifiableLines > 0 || r.suspiciousLines > 0);
  if (!relevant.length) {
    console.log("✅ كل الأطراف لديها بالفعل حساب مستقل — لا يوجد شيء للتعبئة الرجعية.");
    return;
  }

  console.log(`\n=== تقرير التعبئة الرجعية لحسابات الأطراف (${commit ? "تنفيذ فعلي" : "Dry-run — لم يُعدَّل شيء بعد"}) ===\n`);
  const KIND_LABEL: Record<PartyKind, string> = { customer: "عملاء", supplier: "موردون", employee: "موظفون" };
  for (const r of relevant) {
    console.log(
      `${r.companyName} — ${KIND_LABEL[r.kind]}: ${r.missingAccount} بلا حساب مستقل، ` +
      `${r.reclassifiableLines} سطر قيد سيُعاد تصنيفه، ` +
      `${r.suspiciousLines ? `⚠️ ${r.suspiciousLines} سطر مشكوك فيه (لن يُعاد تصنيفه)` : "0 سطر مشكوك فيه"}`,
    );
  }
  const totals = relevant.reduce(
    (s, r) => ({
      missingAccount: s.missingAccount + r.missingAccount,
      reclassifiableLines: s.reclassifiableLines + r.reclassifiableLines,
      suspiciousLines: s.suspiciousLines + r.suspiciousLines,
    }),
    { missingAccount: 0, reclassifiableLines: 0, suspiciousLines: 0 },
  );
  console.log(`\nالإجمالي: ${totals.missingAccount} طرف بلا حساب، ${totals.reclassifiableLines} سطر سيُعاد تصنيفه، ${totals.suspiciousLines} سطر مشكوك فيه.\n`);

  if (!commit) {
    console.log("هذا تقرير فقط — لم يتم تعديل أي بيانات. أعد التشغيل بـ --commit بعد مراجعة الأرقام أعلاه لتنفيذ التعبئة فعلياً.");
    return;
  }

  console.log("جارٍ التنفيذ الفعلي...\n");
  for (const company of companies) {
    await commitForCompany(company.tenantId, company.id, company.name);
  }
  console.log("\n✅ اكتملت التعبئة الرجعية.");
}

main()
  .catch((err) => {
    console.error("خطأ أثناء تنفيذ السكريبت:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
