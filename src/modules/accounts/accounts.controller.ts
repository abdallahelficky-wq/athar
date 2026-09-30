import { RequestHandler } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict, forbidden, notFound } from "../../lib/httpError";
import { assertCompanyAccess, canReadHrData } from "../../middleware/auth";
import { personalFoldFromAccounts } from "../../lib/personalAccounts";
import { createChartFromTemplate, DEFAULT_CHART_OF_ACCOUNTS } from "../../lib/defaultChartOfAccounts";
import { CHART_TEMPLATE_BY_ACTIVITY, BusinessActivity } from "../../lib/chartTemplates";
import { LEVEL_CODE_LENGTH, generateNextCode } from "../../lib/accountCodes";
import { COUNTED_ENTRY_WHERE } from "../../lib/countedEntries";
import { setAuditActor, withAuditActor } from "../../lib/auditActor";

const scopeCompanyId = (value: unknown) => (typeof value === "string" && value ? value : null);

const ACCOUNT_TYPE_LABELS_AR: Record<string, string> = {
  asset: "أصول",
  liability: "التزامات",
  equity: "حقوق ملكية",
  revenue: "إيرادات",
  expense: "مصروفات",
};

async function validateHierarchy(tenantId: string, input: any, currentId?: string) {
  const companyId = input.companyId ?? null;
  const level = Number(input.level);
  const expectedLength = LEVEL_CODE_LENGTH[level];
  if (!expectedLength || !new RegExp(`^\\d{${expectedLength}}$`).test(input.code)) {
    throw badRequest(`كود المستوى ${level} يجب أن يتكون من ${expectedLength ?? "؟"} أرقام`);
  }
  if (level === 4 && !input.isPosting) throw badRequest("حساب المستوى الرابع يجب أن يكون حساب ترحيل");
  if (level < 4 && input.isPosting) throw badRequest("حسابات المستويات من الأول إلى الثالث حسابات تجميعية وليست قابلة للترحيل");
  if (level === 1 && input.parentId) throw badRequest("حساب المستوى الأول لا يقبل حساباً أباً");
  if (level > 1) {
    const parent = await prisma.account.findFirst({ where: { id: input.parentId, tenantId } });
    if (!parent) throw badRequest("اختر الحساب الأب");
    if (parent.isPosting) throw badRequest("لا يمكن إضافة حساب فرعي تحت حساب ترحيل");
    if (parent.id === currentId || parent.level !== level - 1 || (parent.companyId || null) !== companyId) {
      throw badRequest("الحساب الأب يجب أن يكون من المستوى السابق وفي الشجرة نفسها");
    }
    // عند النقل (currentId موجود) يبقى الكود القديم كما هو حفاظاً على أثر المراجعة التاريخي،
    // وقد لا يبدأ بكود الأب الجديد — لذا يُشترط تطابق البادئة عند الإنشاء فقط وليس عند التعديل/النقل.
    if (!currentId && !input.code.startsWith(parent.code)) throw badRequest("كود الحساب يجب أن يبدأ بكود الحساب الأب");
  }
  if (input.isPersonalGroup && input.isPosting) throw badRequest("مجموعة حسابات الأشخاص تكون حساباً تجميعياً لا حساب ترحيل");
  if (input.isPosting && currentId) {
    const children = await prisma.account.count({ where: { parentId: currentId } });
    if (children) throw badRequest("لا يمكن تحويل حساب له حسابات فرعية إلى حساب ترحيل");
  }
}

export const nextAccountCode: RequestHandler = async (req, res) => {
  const parentId = typeof req.query.parentId === "string" ? req.query.parentId : "";
  if (!parentId) throw badRequest("حدد الحساب الأب لتوليد الكود");
  const companyId = scopeCompanyId(req.query.companyId);
  res.json({ code: await generateNextCode(prisma, req.auth!.tenantId, companyId, parentId) });
};

export const listAccounts: RequestHandler = async (req, res) => {
  const tree = req.query.tree === "true";
  const companyId = scopeCompanyId(req.query.companyId);
  if (!tree && !companyId) throw badRequest("حدد الشركة لعرض حسابات الترحيل الخاصة بها");
  const where = tree
    ? { tenantId: req.auth!.tenantId, companyId }
    : { tenantId: req.auth!.tenantId, companyId, isPosting: true, isArchived: false, isActive: true };
  const accounts = await prisma.account.findMany({ where, orderBy: [{ code: "asc" }, { name: "asc" }] });
  if (!tree) return res.json(accounts);

  const lines = await prisma.journalEntryLine.groupBy({
    by: ["accountId"],
    where: { journalEntry: { AND: [COUNTED_ENTRY_WHERE], tenantId: req.auth!.tenantId, companyId: companyId || undefined } },
    _sum: { debit: true, credit: true },
  });
  const direct = new Map(lines.map((line) => [line.accountId, Number(line._sum.debit || 0) - Number(line._sum.credit || 0)]));
  const byParent = new Map<string | null, typeof accounts>();
  accounts.forEach((account) => byParent.set(account.parentId, [...(byParent.get(account.parentId) || []), account]));
  const balance = (account: (typeof accounts)[number]): number =>
    (direct.get(account.id) || 0) + (byParent.get(account.id) || []).reduce((sum, child) => sum + balance(child), 0);
  let result = accounts.map((account) => ({ ...account, balance: balance(account) }));

  // غير أدوار الموارد البشرية: مجموعة حسابات الأشخاص تظهر رصيداً واحداً بلا أبنائها (راجع personalAccounts.ts).
  // رصيد المجموعة محسوب أعلاه من أبنائها قبل الحذف، فيبقى كل أب فوقها صحيحاً.
  if (!canReadHrData(req.auth!)) {
    const fold = personalFoldFromAccounts(accounts);
    result = result.filter((account) => !fold.has(account.id));
  }

  // شاشة شجرة الحسابات فقط تطلب هذا الإخفاء (عبر includePartyAccounts=false) — الحسابات التفصيلية
  // التلقائية لكل عميل/مورد/موظف (Phase G) تبقى ضمن الاستعلام أعلاه دائماً حتى يظل رصيد حساب الأصل
  // التجميعي (byParent/balance) صحيحاً، ونُقصي بعضها فقط من الاستجابة النهائية هنا — لا من الاستعلام
  // نفسه — حتى لا تُحمَّل آلاف الحسابات التفصيلية لواجهة المستخدم عند تصفّح الشجرة العادية. partySearch
  // استثناء: يُبقي على أي حساب طرف يطابق نص البحث ظاهراً حتى مع إطفاء المفتاح.
  const includePartyAccounts = req.query.includePartyAccounts !== "false";
  if (!includePartyAccounts) {
    const partyAccountIds = new Set<string>();
    if (companyId) {
      const partyWhere = { tenantId: req.auth!.tenantId, companyId, accountId: { not: null } } as const;
      const [customers, suppliers, employees] = await Promise.all([
        prisma.customer.findMany({ where: partyWhere, select: { accountId: true } }),
        prisma.supplier.findMany({ where: partyWhere, select: { accountId: true } }),
        prisma.employee.findMany({ where: partyWhere, select: { accountId: true } }),
      ]);
      [...customers, ...suppliers, ...employees].forEach((party) => partyAccountIds.add(party.accountId as string));
    }
    const partySearch = typeof req.query.partySearch === "string" ? req.query.partySearch.trim().toLocaleLowerCase("ar") : "";
    return res.json(
      result.filter((account) => {
        if (!partyAccountIds.has(account.id)) return true;
        if (!partySearch) return false;
        return (
          account.name.toLocaleLowerCase("ar").includes(partySearch) ||
          Boolean(account.nameEn?.toLowerCase().includes(partySearch)) ||
          account.code.includes(partySearch)
        );
      }),
    );
  }

  res.json(result);
};

/** إلغاء طيّ مجموعة أشخاص يكشف رصيد كل شخص — تغيير العلامة لأدوار الموارد البشرية وحدها */
function assertCanChangePersonalGroup(auth: { role: string }, requested: unknown) {
  if (requested !== undefined && !canReadHrData(auth)) throw forbidden("تغيير مجموعة حسابات الأشخاص لأدوار الموارد البشرية فقط");
}

export const createAccount: RequestHandler = async (req, res) => {
  assertCanChangePersonalGroup(req.auth!, req.body.isPersonalGroup);
  const companyId = req.body.companyId ?? null;
  const parent = req.body.parentId
    ? await prisma.account.findFirst({ where: { id: req.body.parentId, tenantId: req.auth!.tenantId, companyId } })
    : null;
  const level = parent ? parent.level + 1 : 1;
  const code = req.body.code || (parent ? await generateNextCode(prisma, req.auth!.tenantId, companyId, parent.id) : null);
  if (!code) throw badRequest("أدخل كود حساب المستوى الأول");
  const data = { ...req.body, companyId, level, code, isPosting: level === 4 };
  await validateHierarchy(req.auth!.tenantId, data);
  const duplicate = await prisma.account.findFirst({ where: { tenantId: req.auth!.tenantId, companyId, code } });
  if (duplicate) throw badRequest(`كود الحساب ${code} مستخدم بالفعل في هذه الشجرة`);
  const account = await prisma.account.create({ data: { ...data, tenantId: req.auth!.tenantId } });
  res.status(201).json(account);
};

export const updateAccount: RequestHandler = async (req, res) => {
  const existing = await prisma.account.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("الحساب غير موجود");
  if (existing.companyId) assertCompanyAccess(req.auth!, existing.companyId);
  assertCanChangePersonalGroup(req.auth!, req.body.isPersonalGroup);
  const { confirmMoveWithTransactions, code: _ignoredCode, level: _ignoredLevel, companyId: _ignoredCompany, ...requestedData } = req.body;
  const moving = requestedData.parentId !== undefined && (requestedData.parentId || null) !== (existing.parentId || null);
  if (moving) {
    const newParent = requestedData.parentId
      ? await prisma.account.findFirst({ where: { id: requestedData.parentId, tenantId: req.auth!.tenantId, companyId: existing.companyId } })
      : null;
    const newLevel = newParent ? newParent.level + 1 : 1;
    if (newLevel !== existing.level) throw badRequest("يمكن نقل الحساب بين أقسام المستوى نفسه فقط حفاظاً على بنية الأكواد والتقارير");
    if (newParent?.isPosting) throw badRequest("لا يمكن نقل حساب تحت حساب ترحيل لأنه يجب أن يظل بدون فروع");
    if (newParent && newParent.type !== existing.type) {
      const fromLabel = ACCOUNT_TYPE_LABELS_AR[existing.type] ?? existing.type;
      const toLabel = ACCOUNT_TYPE_LABELS_AR[newParent.type] ?? newParent.type;
      throw badRequest(`لا يمكن نقل حساب من نوع "${fromLabel}" إلى مجموعة من نوع "${toLabel}" — النقل مسموح فقط بين مجموعات من نفس النوع.`);
    }
    const lines = await prisma.journalEntryLine.count({ where: { accountId: existing.id } });
    if (lines && !confirmMoveWithTransactions) {
      throw badRequest("الحساب مرتبط بقيود سابقة. سيؤثر نقله على تصنيف التقارير التاريخية. أكّد النقل للمتابعة.", { requiresMoveConfirmation: true, journalLines: lines });
    }
  }
  // نوع الحساب يحدّد موضعه في القوائم المالية: بعد وجود قيود عليه (أو على حساب تحته، محفوظة أو مرحَّلة) تغييره يعيد
  // تصنيف أرصدة فترات مُقفَلة بصمت. المُشغِّل account_type_locked يرفضه في قاعدة البيانات أياً كان المسار؛ هنا رسالة واضحة.
  if (requestedData.type !== undefined && requestedData.type !== existing.type) {
    const tree = [existing.id];
    for (let level = [existing.id]; level.length; ) {
      level = (await prisma.account.findMany({ where: { tenantId: req.auth!.tenantId, parentId: { in: level } }, select: { id: true } })).map((c) => c.id);
      tree.push(...level);
    }
    const lines = await prisma.journalEntryLine.count({ where: { accountId: { in: tree } } });
    if (lines) throw badRequest("لا يمكن تغيير نوع حساب عليه قيود أو على حساب تحته — النوع يحدّد موضعه في القوائم المالية. أنشئ حساباً جديداً بالنوع المطلوب وانقل إليه بقيد.", { journalLines: lines });
  }
  // يبقى الكود ثابتاً عند النقل حتى يظل معرّف الحساب مستقراً في المراجعات والتقارير التاريخية.
  const data = { ...existing, ...requestedData, code: existing.code, level: existing.level, companyId: existing.companyId };
  await validateHierarchy(req.auth!.tenantId, data, existing.id);
  // كل تعديل (ومنه النقل والأرشفة المتسلسلة) يُسجَّل بمُشغِّل account_record_change: الحقول قبل/بعد ومن نفّذه
  const account = await withAuditActor(req.auth!.sub, async (tx) => {
    const updated = await tx.account.update({ where: { id: existing.id }, data: requestedData });
    if (typeof requestedData.isArchived === "boolean") {
      const descendants: string[] = [];
      let parentIds = [existing.id];
      while (parentIds.length) {
        const children = await tx.account.findMany({ where: { tenantId: req.auth!.tenantId, parentId: { in: parentIds } }, select: { id: true } });
        parentIds = children.map((child) => child.id);
        descendants.push(...parentIds);
      }
      if (descendants.length) await tx.account.updateMany({ where: { id: { in: descendants } }, data: { isArchived: requestedData.isArchived } });
    }
    return updated;
  });
  res.json(account);
};

export const importAccounts: RequestHandler = async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const companyId = req.body.companyId ?? null;
  const rows = req.body.rows as Array<{
    code: string;
    name: string;
    nameEn: string;
    type: "asset" | "liability" | "equity" | "revenue" | "expense";
    level: number;
    isPosting: boolean;
    parentCode?: string | null;
    isBankOrCash?: boolean;
  }>;

  if (companyId) {
    const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
    if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
  }

  const codeCounts = new Map<string, number>();
  rows.forEach((row) => codeCounts.set(row.code, (codeCounts.get(row.code) || 0) + 1));
  const duplicateCodes = [...codeCounts.entries()].filter(([, count]) => count > 1).map(([code]) => code);
  if (duplicateCodes.length) throw badRequest("ملف الاستيراد يحتوي على أكواد مكررة", { duplicateCodes });

  const existing = await prisma.account.findMany({
    where: { tenantId, companyId, code: { in: rows.map((row) => row.code) } },
    select: { code: true },
  });
  if (existing.length) {
    throw badRequest("بعض الأكواد موجودة بالفعل في الشجرة المحددة", { existingCodes: existing.map((row) => row.code) });
  }

  for (const row of rows) {
    const expectedLength = LEVEL_CODE_LENGTH[row.level];
    if (!expectedLength || !new RegExp(`^\\d{${expectedLength}}$`).test(row.code)) {
      throw badRequest(`حساب المستوى ${row.level} (${row.code}) يجب أن يحمل كوداً من ${expectedLength ?? "؟"} أرقام`);
    }
    if (row.isPosting !== (row.level === 4)) throw badRequest(`الحساب ${row.code}: الترحيل متاح حصراً في المستوى الرابع`);
    if (row.level === 1 && row.parentCode) throw badRequest(`الحساب ${row.code} من المستوى الأول ولا يقبل حساباً أباً`);
    if (row.level > 1 && !row.parentCode) throw badRequest(`الحساب الأب مفقود للكود ${row.code}`);
    if (row.level > 1 && row.parentCode && !row.code.startsWith(row.parentCode)) {
      throw badRequest(`كود الحساب ${row.code} يجب أن يبدأ بكود الحساب الأب ${row.parentCode}`);
    }
  }
  const importedChildren = new Set(rows.map((row) => row.parentCode).filter(Boolean));
  const postingParents = rows.filter((row) => row.isPosting && importedChildren.has(row.code)).map((row) => row.code);
  if (postingParents.length) {
    throw badRequest("حساب الترحيل لا يمكن أن يحتوي على حسابات فرعية", { postingParents });
  }

  const orderedRows = [...rows].sort((a, b) => a.level - b.level || a.code.localeCompare(b.code));
  const created = await prisma.$transaction(async (tx) => {
    const existingParents = await tx.account.findMany({ where: { tenantId, companyId } });
    const accountsByCode = new Map(existingParents.map((account) => [account.code, account]));
    const result = [];

    for (const row of orderedRows) {
      const parent = row.level > 1 ? accountsByCode.get(row.parentCode as string) : null;
      if (row.level > 1 && (!parent || parent.level !== row.level - 1)) {
        throw badRequest(`الحساب الأب ${row.parentCode} غير موجود بالمستوى السابق للحساب ${row.code}`);
      }
      if (parent?.isPosting) throw badRequest(`الحساب الأب ${row.parentCode} هو حساب ترحيل ولا يقبل حسابات فرعية`);
      const account = await tx.account.create({
        data: {
          tenantId,
          companyId,
          parentId: parent?.id || null,
          code: row.code,
          name: row.name.trim(),
          nameEn: row.nameEn.trim(),
          type: row.type,
          level: row.level,
          isPosting: row.isPosting,
          isBankOrCash: Boolean(row.isBankOrCash && row.type === "asset" && row.isPosting),
        },
      });
      accountsByCode.set(account.code, account);
      result.push(account);
    }
    return result;
  });

  res.status(201).json({ imported: created.length });
};

/** عدد صفوف كل جدول دفاتر في النطاق — أي صف (مرحّل أو مسودة) يعني أن الشركة ليست فارغة. */
async function countBooks(client: Prisma.TransactionClient, scope: { tenantId: string; companyId?: string }) {
  const [journalEntries, salesInvoices, salesReturns, salesDebitNotes, purchaseInvoices, purchaseReturns, receipts, quotations,
    stockMovements, fixedAssets, depreciationRuns, payrollRuns, employeeAdvances, stationShifts] = await Promise.all([
    client.journalEntry.count({ where: scope }),
    client.salesInvoice.count({ where: scope }),
    client.salesReturn.count({ where: scope }),
    client.salesDebitNote.count({ where: scope }),
    client.purchaseInvoice.count({ where: scope }),
    client.purchaseReturn.count({ where: scope }),
    client.receipt.count({ where: scope }),
    client.quotation.count({ where: scope }),
    client.stockMovement.count({ where: scope }),
    client.fixedAsset.count({ where: scope }),
    client.depreciationRun.count({ where: scope }),
    client.payrollRun.count({ where: scope }),
    client.employeeAdvance.count({ where: scope }),
    client.stationShift.count({ where: scope }),
  ]);
  const leaveSettlements = await client.leaveSettlement.count({
    where: scope.companyId ? { tenantId: scope.tenantId, employee: { companyId: scope.companyId } } : { tenantId: scope.tenantId },
  });
  return {
    journalEntries, salesInvoices, salesReturns, salesDebitNotes, purchaseInvoices, purchaseReturns, receipts, quotations,
    stockMovements, fixedAssets, depreciationRuns, payrollRuns, employeeAdvances, stationShifts, leaveSettlements,
  };
}

export const installStandardChart: RequestHandler = async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const userId = req.auth!.sub;
  const companyId = req.body.companyId ?? null;

  let company: { id: string; name: string; businessActivity: BusinessActivity | null } | null = null;
  if (companyId) {
    company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
    if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
  }

  // تثبيت الشجرة القياسية إجراء إعداد لشركة فارغة فقط: يُرفَض رفضاً قاطعاً — لا صلاحية ولا تأكيد
  // يتجاوزه — متى وُجد في نطاقه (الشركة، أو كل شركات المستأجر بلا companyId) أي قيد أو مستند مالي،
  // مرحَّلاً كان أو مسودة. لا يوجد إطلاقاً "أعد تثبيت الشجرة واحذف دفاتري": هذا المسار كان يحذف كل
  // القيود والفواتير (بما فيها المُبلَّغة لزاتكا) — حُذف ذلك الحذف كلياً، فلا يبقى إلا استبدال شجرة
  // شركة لم يُسجَّل فيها شيء بعد.
  const result = await prisma.$transaction(
    async (tx) => {
      await setAuditActor(tx, req.auth!.sub); // حذف الشجرة القديمة يُسجَّل حساباً حساباً (account_record_change)
      // الفحص داخل نفس المعاملة وبعد قفل صفوف الشركات في النطاق (FOR UPDATE): كل قيد يُنشأ في النظام
      // يحدّث صف شركته أولاً (حجز رقم القيد في journalPosting.ts)، فلا يمكن أن يُرحَّل شيء بين الفحص
      // والاستبدال. وأي سطر مستند أو قيد يشير لحساب قديم يمنع حذفه بقيد المفتاح الأجنبي.
      if (companyId) {
        await tx.$queryRaw`SELECT id FROM "companies" WHERE "tenantId" = ${tenantId} AND id = ${companyId} FOR UPDATE`;
      } else {
        await tx.$queryRaw`SELECT id FROM "companies" WHERE "tenantId" = ${tenantId} ORDER BY id FOR UPDATE`;
      }
      const bookCounts = await countBooks(tx, companyId ? { tenantId, companyId } : { tenantId });
      if (Object.values(bookCounts).some((n) => n > 0)) {
        throw conflict(
          companyId
            ? `لا يمكن تثبيت الشجرة القياسية: شركة "${company!.name}" تحتوي على قيود أو مستندات مالية. تثبيت الشجرة متاح لشركة فارغة فقط، ولا يحذف أي دفاتر.`
            : "لا يمكن تثبيت الشجرة القياسية: شركات المستأجر تحتوي على قيود أو مستندات مالية. تثبيت الشجرة متاح لشركة فارغة فقط، ولا يحذف أي دفاتر.",
        );
      }

      const accountScope = { tenantId, companyId };
      let deletedAccounts = 0;
      for (let level = 4; level >= 1; level -= 1) {
        deletedAccounts += (await tx.account.deleteMany({ where: { ...accountScope, level } })).count;
      }

      await tx.company.updateMany({
        where: companyId ? { id: companyId, tenantId } : { tenantId },
        data: { nextJournalEntrySeq: 1 },
      });
      // نفس منطق اختيار القالب عند إنشاء الشركة: قالب النشاط القطاعي إن كان محدداً لهذه الشركة،
      // وإلا القالب العام الافتراضي — حتى لا تفقد شركة اختارت نشاطاً قطاعياً شجرتها المتخصصة عند
      // إعادة التثبيت.
      const activity = company?.businessActivity as BusinessActivity | null | undefined;
      const template = activity ? CHART_TEMPLATE_BY_ACTIVITY[activity] : DEFAULT_CHART_OF_ACCOUNTS;
      await createChartFromTemplate(tx, tenantId, companyId, template);

      // سجل تدقيق إلزامي على كل عملية تثبيت شجرة قياسية — من نفّذها، متى بالضبط، ولأي نطاق
      // (شركة محددة أو المستأجر بالكامل)، وعدد الحسابات القديمة التي استُبدلت.
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: "accounts.install_standard_chart",
          entityType: companyId ? "Company" : "Tenant",
          entityId: companyId || tenantId,
          metadata: { companyId, companyName: company?.name ?? null, deletedAccounts },
        },
      });

      return { deletedAccounts, installedAccounts: template.length };
    },
    // مهلة أطول من الافتراضي (5 ثوانٍ): إعادة زرع الشجرة القياسية كاملة قد تستغرق أطول من المعتاد
    // على شبكة الإنتاج.
    { timeout: 20_000, maxWait: 10_000 },
  );

  res.status(201).json(result);
};

export const deleteAccount: RequestHandler = async (req, res) => {
  const existing = await prisma.account.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("الحساب غير موجود");
  if (existing.companyId) assertCompanyAccess(req.auth!, existing.companyId);
  const [children, lines] = await Promise.all([
    prisma.account.count({ where: { parentId: existing.id } }),
    prisma.journalEntryLine.count({ where: { accountId: existing.id } }),
  ]);
  if (children || lines) {
    const reasons = [children ? `${children} حسابات فرعية` : "", lines ? `${lines} حركات أو قيود مرتبطة` : ""].filter(Boolean).join(" و");
    throw badRequest(`لا يمكن حذف الحساب لوجود ${reasons}. استخدم الأرشفة بدلاً من الحذف.`, { children, journalLines: lines });
  }
  await withAuditActor(req.auth!.sub, (tx) => tx.account.delete({ where: { id: existing.id } }));
  res.status(204).send();
};
