import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "./integrationTestGuard";
import { getTrialBalanceReport, getTrialBalanceTree, getBalanceSheet, getCustomerStatement } from "../modules/reports/reports.service";
import type { TrialBalanceTreeNode, AmountTreeNode } from "../modules/reports/reports.service";

/**
 * اختبار تكامل حقيقي على Postgres فعلي يثبت أن migration 20260923100000_party_subledger_grouping
 * (فصل الحسابات القياسية عن حسابات العملاء/الموردين التفصيلية التلقائية تحت 112/211) لا يحرّك أي
 * رقم مالي فعلي: يبني شركة بالشكل القديم (112 باسمه القديم، وحساباته القياسية + حساب عميل تلقائي
 * كلها أبناء مباشرون له، تماماً كما كانت الشجرة قبل هذا الـPR)، يرحّل فاتورة ومقبوضات حقيقية عليها،
 * يلتقط التقارير، يشغّل ملف الـmigration الفعلي المشحون حرفياً (لا نسخة منه)، ثم يعيد الالتقاط ويقارن.
 *
 * ملاحظة منهجية مهمة: "ميزان المراجعة" المستخدَم لإثبات التطابق الحرفي هو getTrialBalanceReport
 * المسطّح (صف واحد لكل حساب ترحيل فعلي، بلا أي إشارة لأبيه) — لا getTrialBalanceTree الهرمي ولا
 * شجرة المركز المالي (assetRoots...)، لأن كليهما يعرضان شجرة الحسابات الفعلية بالتصميم، فتتغيّر
 * عقدهما الوسيطة حتماً (112 يُعاد تسميته، 117 يظهر) — وهذا بالضبط الأثر البصري المقصود من الميزة،
 * لا عيباً. الأرقام المالية نفسها (كل صف مسطّح، وكل ورقة داخل الشجرة الهرمية، وكل إجمالي أعلى) تبقى
 * مطابقة حرفياً كما تُثبِت الأسطر أدناه — فقط شكل العرض الهرمي الوسيط يتغيّر عمداً.
 */
guardAgainstUnsafeIntegrationTestDatabase();

function findNode(nodes: TrialBalanceTreeNode[], code: string): TrialBalanceTreeNode | null {
  for (const node of nodes) {
    if (node.code === code) return node;
    const found = findNode(node.children, code);
    if (found) return found;
  }
  return null;
}

/** يفرّغ شجرة أي تقرير هرمي (المركز المالي) إلى أوراقها فقط (isPosting=true)، مرتّبة بالكود —
 * لإثبات أن كل حساب ترحيل فعلي يحمل نفس الرقم بالضبط قبل/بعد، بصرف النظر عن تغيّر تجميعه الوسيط. */
function leaves(nodes: AmountTreeNode[]): AmountTreeNode[] {
  const result: AmountTreeNode[] = [];
  const walk = (list: AmountTreeNode[]) => {
    for (const node of list) {
      if (node.isPosting) result.push(node);
      else walk(node.children);
    }
  };
  walk(nodes);
  return result.sort((a, b) => a.code.localeCompare(b.code));
}

/** ينفّذ ملف الـmigration الفعلي المشحون حرفياً (لا نسخة منه) ضد قاعدة الاختبار — تقسيم بسيط على
 * الفاصلة المنقوطة في نهاية السطر يكفي هنا لأن جمل SQL بالملف لا تحوي فاصلة منقوطة داخل أي نص. */
async function runShippedMigration() {
  const sqlPath = path.join(__dirname, "..", "..", "prisma", "migrations", "20260923100000_party_subledger_grouping", "migration.sql");
  const raw = readFileSync(sqlPath, "utf8");
  const withoutComments = raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const statements = withoutComments.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}

describe("party sub-ledger grouping migration (integration)", () => {
  let tenantId: string;
  let companyId: string;
  let customerId: string;
  let customerAccountId: string;
  let standardAccount1Id: string;
  let standardAccount2Id: string;

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: "Test Tenant PSG", unlockPin: "hashed" } });
    tenantId = tenant.id;
    const company = await prisma.company.create({ data: { tenantId, name: "Co PSG", zatcaOnboardingStatus: "not_onboarded" } });
    companyId = company.id;

    // الشجرة القديمة قبل الـmigration بالضبط: 112 باسمه القديم، وكل أبنائه (القياسية + حساب العميل
    // التلقائي) أبناء مباشرون له — لا مجموعة 117 هنا إطلاقاً، تماماً كحال أي شركة حقيقية اليوم.
    const a1 = await prisma.account.create({ data: { tenantId, companyId, code: "1", level: 1, isPosting: false, name: "الأصول", type: "asset" } });
    const a11 = await prisma.account.create({ data: { tenantId, companyId, parentId: a1.id, code: "11", level: 2, isPosting: false, name: "الأصول المتداولة", type: "asset" } });
    const a112 = await prisma.account.create({ data: { tenantId, companyId, parentId: a11.id, code: "112", level: 3, isPosting: false, name: "الذمم المدينة التجارية", type: "asset" } });
    const standard1 = await prisma.account.create({ data: { tenantId, companyId, parentId: a112.id, code: "112001", level: 4, isPosting: true, name: "عملاء - مبيعات جملة/عقود", type: "asset" } });
    const standard2 = await prisma.account.create({ data: { tenantId, companyId, parentId: a112.id, code: "112003", level: 4, isPosting: true, name: "أوراق قبض", type: "asset" } });
    standardAccount1Id = standard1.id;
    standardAccount2Id = standard2.id;
    const customerAccount = await prisma.account.create({ data: { tenantId, companyId, parentId: a112.id, code: "112006", level: 4, isPosting: true, name: "شركة الاختبار PSG", type: "asset" } });
    customerAccountId = customerAccount.id;

    const revenueAccount = await prisma.account.create({ data: { tenantId, companyId, code: "4001", level: 1, isPosting: true, name: "إيرادات مبيعات", type: "revenue" } });
    const vatAccount = await prisma.account.create({ data: { tenantId, companyId, code: "2101", level: 1, isPosting: true, name: "ضريبة القيمة المضافة - مخرجات", type: "liability" } });
    const bankAccount = await prisma.account.create({ data: { tenantId, companyId, code: "1101", level: 1, isPosting: true, name: "بنك - حساب جاري", type: "asset", isBankOrCash: true } });

    const customer = await prisma.customer.create({
      data: { tenantId, companyId, name: "شركة الاختبار PSG", customerType: "business", vatNumber: "300000000000005", accountId: customerAccount.id },
    });
    customerId = customer.id;

    // فاتورة مرحّلة حقيقية (قيد يدوي مباشر، بنفس شكل قيد فاتورة مرحّلة فعلية): مدين حساب العميل
    // 1150، دائن الإيراد 1000 ودائن ضريبة القيمة المضافة 150.
    const invoiceEntry = await prisma.journalEntry.create({
      data: {
        tenantId, companyId, entryNumber: "J-PSG-1", date: new Date("2026-01-05"), memo: "فاتورة اختبار PSG",
        lines: {
          create: [
            { accountId: customerAccount.id, debit: 1150, credit: 0, description: "فاتورة" },
            { accountId: revenueAccount.id, debit: 0, credit: 1000, description: "إيراد" },
            { accountId: vatAccount.id, debit: 0, credit: 150, description: "ضريبة" },
          ],
        },
      },
    });
    void invoiceEntry;

    // مقبوضات جزئية حقيقية على نفس الفاتورة: مدين البنك 700، دائن حساب العميل 700.
    const receiptEntry = await prisma.journalEntry.create({
      data: {
        tenantId, companyId, entryNumber: "J-PSG-2", date: new Date("2026-01-15"), memo: "مقبوضات اختبار PSG",
        lines: {
          create: [
            { accountId: bankAccount.id, debit: 700, credit: 0, description: "تحصيل" },
            { accountId: customerAccount.id, debit: 0, credit: 700, description: "تحصيل من العميل" },
          ],
        },
      },
    });
    void receiptEntry;

    // حركة على حساب قياسي (112001) لا علاقة لها بأي عميل — تمثّل رصيداً حقيقياً على حساب سيُنقَل
    // إلى 117، حتى يثبت الاختبار أن رصيده ينتقل معه لا يضيع ولا يبقى تحت 112.
    await prisma.journalEntry.create({
      data: {
        tenantId, companyId, entryNumber: "J-PSG-3", date: new Date("2026-01-08"), memo: "قيد على حساب قياسي 112001",
        lines: {
          create: [
            { accountId: standard1.id, debit: 500, credit: 0, description: "مدين 112001" },
            { accountId: revenueAccount.id, debit: 0, credit: 500, description: "دائن مقابل" },
          ],
        },
      },
    });

    // وحركة أخرى على حساب قياسي ثانٍ (112003) لتغطية أكثر من حساب قياسي واحد.
    await prisma.journalEntry.create({
      data: {
        tenantId, companyId, entryNumber: "J-PSG-4", date: new Date("2026-01-09"), memo: "قيد على حساب قياسي 112003",
        lines: {
          create: [
            { accountId: standard2.id, debit: 200, credit: 0, description: "مدين 112003" },
            { accountId: revenueAccount.id, debit: 0, credit: 200, description: "دائن مقابل" },
          ],
        },
      },
    });
  }, 30000);

  afterAll(async () => {
    await prisma.journalEntryLine.deleteMany({ where: { journalEntry: { tenantId } } });
    await prisma.journalEntry.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.account.deleteMany({ where: { tenantId } });
    await prisma.company.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });

  it("leaves trial balance, balance sheet and customer statement byte-identical after the migration runs", async () => {
    const dateTo = new Date("2026-01-31");

    // ميزان المراجعة المسطّح (level=4، صف واحد لكل حساب ترحيل فعلي بلا أي إشارة لأبيه) هو المُثبِت
    // الحرفي: لا يتأثر إطلاقاً بأي إعادة تجميع وسيطة، فيبقى JSON مطابقاً حرفاً بحرف قبل/بعد.
    const flatBefore = await getTrialBalanceReport(tenantId, companyId, undefined, dateTo, { level: 4 });
    const tbBefore = await getTrialBalanceTree(tenantId, companyId, undefined, dateTo, {});
    const bsBefore = await getBalanceSheet(tenantId, companyId, dateTo);
    const csBefore = await getCustomerStatement(tenantId, customerId, companyId);
    const bsLeavesBefore = {
      assets: leaves(bsBefore.assetRoots), liabilities: leaves(bsBefore.liabilityRoots), equity: leaves(bsBefore.equityRoots),
    };

    const node112Before = findNode(tbBefore.roots, "112");
    const node11Before = findNode(tbBefore.roots, "11");
    expect(node112Before, "112 must exist before migration").not.toBeNull();
    expect(node11Before, "11 must exist before migration").not.toBeNull();
    // قبل الـmigration: 112 يحمل كل شيء — رصيد العميل الصافي (450 = 1150 - 700) + الحسابين
    // القياسيين (500 + 200) = 1150.
    expect(node112Before!.closing.debit - node112Before!.closing.credit).toBeCloseTo(1150, 2);

    await runShippedMigration();

    const flatAfter = await getTrialBalanceReport(tenantId, companyId, undefined, dateTo, { level: 4 });
    const tbAfter = await getTrialBalanceTree(tenantId, companyId, undefined, dateTo, {});
    const bsAfter = await getBalanceSheet(tenantId, companyId, dateTo);
    const csAfter = await getCustomerStatement(tenantId, customerId, companyId);
    const bsLeavesAfter = {
      assets: leaves(bsAfter.assetRoots), liabilities: leaves(bsAfter.liabilityRoots), equity: leaves(bsAfter.equityRoots),
    };

    // الإثبات المركزي: ميزان المراجعة المسطّح، وكل ورقة (حساب ترحيل فعلي) داخل شجرة المركز المالي،
    // وإجماليات المركز المالي، وكشف حساب العميل — كلها حرفياً كما هي (JSON.stringify، لا deep-equal
    // متسامح). العقد الوسيطة لشجرتي ميزان المراجعة/المركز المالي (112/117) تتغيّر عمداً — هذا هو
    // الأثر البصري المقصود من الميزة نفسها، لا كسراً في رقم مالي.
    expect(JSON.stringify(flatAfter)).toBe(JSON.stringify(flatBefore));
    expect(JSON.stringify(bsLeavesAfter)).toBe(JSON.stringify(bsLeavesBefore));
    expect(JSON.stringify({ totalAssets: bsAfter.totalAssets, totalLiabilities: bsAfter.totalLiabilities, totalEquityBase: bsAfter.totalEquityBase, totalEquity: bsAfter.totalEquity, netIncome: bsAfter.netIncome, balanced: bsAfter.balanced }))
      .toBe(JSON.stringify({ totalAssets: bsBefore.totalAssets, totalLiabilities: bsBefore.totalLiabilities, totalEquityBase: bsBefore.totalEquityBase, totalEquity: bsBefore.totalEquity, netIncome: bsBefore.netIncome, balanced: bsBefore.balanced }));
    expect(JSON.stringify(csAfter)).toBe(JSON.stringify(csBefore));

    // إجمالي الأصول المتداولة ("11") يبقى كما هو تماماً — إعادة التصنيف الداخلي تحت 112/117 لا
    // يغيّر أي إجمالي أعلى في الشجرة.
    const node11After = findNode(tbAfter.roots, "11");
    expect(node11After!.closing.debit - node11After!.closing.credit).toBeCloseTo(node11Before!.closing.debit - node11Before!.closing.credit, 2);

    // 112 بعد الـmigration يحمل فقط صافي حساب العميل التفصيلي (450)، لا الحسابين القياسيين.
    const node112After = findNode(tbAfter.roots, "112");
    const node117After = findNode(tbAfter.roots, "117");
    expect(node112After, "112 must still exist after migration").not.toBeNull();
    expect(node117After, "117 must be created by the migration").not.toBeNull();
    expect(node112After!.closing.debit - node112After!.closing.credit).toBeCloseTo(450, 2);
    expect(node117After!.closing.debit - node117After!.closing.credit).toBeCloseTo(700, 2);
    // مجموع 112 القديم يتوزّع بالكامل بين 112 الجديد و117 — لا رصيد يُفقَد ولا يُضاعَف.
    expect(
      (node112After!.closing.debit - node112After!.closing.credit) + (node117After!.closing.debit - node117After!.closing.credit),
    ).toBeCloseTo(node112Before!.closing.debit - node112Before!.closing.credit, 2);

    // تحقّق بنيوي مباشر من قاعدة البيانات: 112 أُعيد تسميته، والحسابان القياسيان انتقلا فعلياً إلى
    // 117، بينما حساب العميل التلقائي بقي مكانه تحت 112 (كوده وأبوه القديم لم يتغيّرا).
    const [renamed112, group117, movedStandard1, movedStandard2, untouchedCustomerAccount] = await Promise.all([
      prisma.account.findUnique({ where: { id: (await prisma.account.findFirstOrThrow({ where: { tenantId, companyId, code: "112" } })).id } }),
      prisma.account.findFirst({ where: { tenantId, companyId, code: "117" } }),
      prisma.account.findUniqueOrThrow({ where: { id: standardAccount1Id } }),
      prisma.account.findUniqueOrThrow({ where: { id: standardAccount2Id } }),
      prisma.account.findUniqueOrThrow({ where: { id: customerAccountId } }),
    ]);
    expect(renamed112!.name).toBe("عملاء");
    expect(renamed112!.nameEn).toBe("Customers");
    expect(group117).not.toBeNull();
    expect(group117!.isPosting).toBe(false);
    expect(group117!.parentId).toBe(renamed112!.parentId);
    expect(movedStandard1.parentId).toBe(group117!.id);
    expect(movedStandard1.code).toBe("112001");
    expect(movedStandard2.parentId).toBe(group117!.id);
    expect(movedStandard2.code).toBe("112003");
    expect(untouchedCustomerAccount.parentId).toBe(renamed112!.id);
    expect(untouchedCustomerAccount.code).toBe("112006");
  }, 30000);

  it("is idempotent: running it again changes nothing further", async () => {
    const dateTo = new Date("2026-01-31");
    const tbBefore = await getTrialBalanceTree(tenantId, companyId, undefined, dateTo, {});
    const accountsBefore = await prisma.account.findMany({ where: { tenantId, companyId }, orderBy: { id: "asc" } });

    await runShippedMigration();

    const tbAfter = await getTrialBalanceTree(tenantId, companyId, undefined, dateTo, {});
    const accountsAfter = await prisma.account.findMany({ where: { tenantId, companyId }, orderBy: { id: "asc" } });

    expect(JSON.stringify(tbAfter)).toBe(JSON.stringify(tbBefore));
    expect(accountsAfter.map((a) => ({ id: a.id, code: a.code, name: a.name, parentId: a.parentId }))).toEqual(
      accountsBefore.map((a) => ({ id: a.id, code: a.code, name: a.name, parentId: a.parentId })),
    );
  }, 30000);
});
