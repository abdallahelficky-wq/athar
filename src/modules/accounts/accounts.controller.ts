import { RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { createChartFromTemplate, DEFAULT_CHART_OF_ACCOUNTS } from "../../lib/defaultChartOfAccounts";
import { CHART_TEMPLATE_BY_ACTIVITY, BusinessActivity } from "../../lib/chartTemplates";

const scopeCompanyId = (value: unknown) => (typeof value === "string" && value ? value : null);

// طول كود كل مستوى: الأول رقم واحد، الثاني رقمان، الثالث ثلاثة أرقام، الرابع (حسابات الترحيل)
// ستة أرقام — أي حتى 999 حساب ترحيل تحت كل فرع مستوى ثالث (كان رقماً إضافياً واحداً فقط/9 حسابات
// كحد أقصى، فتبيّن عملياً أنه ضيق جداً لشركات فيها عشرات العملاء/الموردين تحت فرع واحد).
const LEVEL_CODE_LENGTH: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 6 };

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
  if (input.isPosting && currentId) {
    const children = await prisma.account.count({ where: { parentId: currentId } });
    if (children) throw badRequest("لا يمكن تحويل حساب له حسابات فرعية إلى حساب ترحيل");
  }
}

async function generateNextCode(tenantId: string, companyId: string | null, parentId: string) {
  const parent = await prisma.account.findFirst({ where: { id: parentId, tenantId, companyId } });
  if (!parent) throw badRequest("الحساب الأب غير موجود في الشجرة المحددة");
  if (parent.isPosting || parent.level >= 4) throw badRequest("حساب الترحيل لا يقبل حسابات فرعية");
  const childLevel = parent.level + 1;
  const targetLength = LEVEL_CODE_LENGTH[childLevel];
  const suffixWidth = targetLength - parent.code.length;
  const siblings = await prisma.account.findMany({ where: { tenantId, companyId, parentId }, select: { code: true } });
  const usedSuffixes = siblings.map((account) => Number(account.code.slice(parent.code.length)) || 0);
  const next = Math.max(0, ...usedSuffixes) + 1;
  const maxSuffix = Number("9".repeat(suffixWidth));
  if (next > maxSuffix) throw badRequest("تعذر توليد كود جديد ضمن الحد المسموح لهذا المستوى");
  return parent.code + String(next).padStart(suffixWidth, "0");
}

export const nextAccountCode: RequestHandler = async (req, res) => {
  const parentId = typeof req.query.parentId === "string" ? req.query.parentId : "";
  if (!parentId) throw badRequest("حدد الحساب الأب لتوليد الكود");
  const companyId = scopeCompanyId(req.query.companyId);
  res.json({ code: await generateNextCode(req.auth!.tenantId, companyId, parentId) });
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
    where: { journalEntry: { tenantId: req.auth!.tenantId, companyId: companyId || undefined } },
    _sum: { debit: true, credit: true },
  });
  const direct = new Map(lines.map((line) => [line.accountId, Number(line._sum.debit || 0) - Number(line._sum.credit || 0)]));
  const byParent = new Map<string | null, typeof accounts>();
  accounts.forEach((account) => byParent.set(account.parentId, [...(byParent.get(account.parentId) || []), account]));
  const balance = (account: (typeof accounts)[number]): number =>
    (direct.get(account.id) || 0) + (byParent.get(account.id) || []).reduce((sum, child) => sum + balance(child), 0);
  res.json(accounts.map((account) => ({ ...account, balance: balance(account) })));
};

export const createAccount: RequestHandler = async (req, res) => {
  const companyId = req.body.companyId ?? null;
  const parent = req.body.parentId
    ? await prisma.account.findFirst({ where: { id: req.body.parentId, tenantId: req.auth!.tenantId, companyId } })
    : null;
  const level = parent ? parent.level + 1 : 1;
  const code = req.body.code || (parent ? await generateNextCode(req.auth!.tenantId, companyId, parent.id) : null);
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
  const { confirmMoveWithTransactions, code: _ignoredCode, level: _ignoredLevel, companyId: _ignoredCompany, ...requestedData } = req.body;
  const moving = requestedData.parentId !== undefined && (requestedData.parentId || null) !== (existing.parentId || null);
  if (moving) {
    const newParent = requestedData.parentId
      ? await prisma.account.findFirst({ where: { id: requestedData.parentId, tenantId: req.auth!.tenantId, companyId: existing.companyId } })
      : null;
    const newLevel = newParent ? newParent.level + 1 : 1;
    if (newLevel !== existing.level) throw badRequest("يمكن نقل الحساب بين أقسام المستوى نفسه فقط حفاظاً على بنية الأكواد والتقارير");
    if (newParent?.isPosting) throw badRequest("لا يمكن نقل حساب تحت حساب ترحيل لأنه يجب أن يظل بدون فروع");
    const lines = await prisma.journalEntryLine.count({ where: { accountId: existing.id } });
    if (lines && !confirmMoveWithTransactions) {
      throw badRequest("الحساب مرتبط بقيود سابقة. سيؤثر نقله على تصنيف التقارير التاريخية. أكّد النقل للمتابعة.", { requiresMoveConfirmation: true, journalLines: lines });
    }
  }
  // يبقى الكود ثابتاً عند النقل حتى يظل معرّف الحساب مستقراً في المراجعات والتقارير التاريخية.
  const data = { ...existing, ...requestedData, code: existing.code, level: existing.level, companyId: existing.companyId };
  await validateHierarchy(req.auth!.tenantId, data, existing.id);
  const account = await prisma.account.update({ where: { id: existing.id }, data: requestedData });
  if (typeof requestedData.isArchived === "boolean") {
    const descendants: string[] = [];
    let parentIds = [existing.id];
    while (parentIds.length) {
      const children = await prisma.account.findMany({ where: { tenantId: req.auth!.tenantId, parentId: { in: parentIds } }, select: { id: true } });
      parentIds = children.map((child) => child.id);
      descendants.push(...parentIds);
    }
    if (descendants.length) await prisma.account.updateMany({ where: { id: { in: descendants } }, data: { isArchived: requestedData.isArchived } });
  }
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

export const installStandardChart: RequestHandler = async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const userId = req.auth!.sub;
  const companyId = req.body.companyId ?? null;

  let company: { id: string; name: string; businessActivity: BusinessActivity | null } | null = null;
  if (companyId) {
    company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
    if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const financialScope = companyId ? { tenantId, companyId } : { tenantId };
      const employeeIds = companyId
        ? (await tx.employee.findMany({ where: { tenantId, companyId }, select: { id: true } })).map((employee) => employee.id)
        : [];

      const deleted = {
        receipts: (await tx.receipt.deleteMany({ where: financialScope })).count,
        salesReturns: (await tx.salesReturn.deleteMany({ where: financialScope })).count,
        salesInvoices: (await tx.salesInvoice.deleteMany({ where: financialScope })).count,
        purchaseReturns: (await tx.purchaseReturn.deleteMany({ where: financialScope })).count,
        purchaseInvoices: (await tx.purchaseInvoice.deleteMany({ where: financialScope })).count,
        stockMovements: (await tx.stockMovement.deleteMany({ where: financialScope })).count,
        depreciationRuns: (await tx.depreciationRun.deleteMany({ where: financialScope })).count,
        fixedAssets: (await tx.fixedAsset.deleteMany({ where: financialScope })).count,
        payrollRuns: (await tx.payrollRun.deleteMany({ where: financialScope })).count,
        leaveSettlements: (await tx.leaveSettlement.deleteMany({
          where: companyId ? { tenantId, employeeId: { in: employeeIds } } : { tenantId },
        })).count,
        journalEntries: (await tx.journalEntry.deleteMany({ where: financialScope })).count,
      };

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
      // (شركة محددة أو المستأجر بالكامل)، بما في ذلك كل ما تم حذفه قبل إعادة التثبيت.
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: "accounts.install_standard_chart",
          entityType: companyId ? "Company" : "Tenant",
          entityId: companyId || tenantId,
          metadata: { companyId, companyName: company?.name ?? null, deleted, deletedAccounts },
        },
      });

      return { deleted, deletedAccounts, installedAccounts: template.length };
    },
    // مهلة أطول من الافتراضي (5 ثوانٍ): هذه المعاملة تحذف عدة جداول ثم تُعيد زرع الشجرة القياسية،
    // وقد تستغرق أطول من المعتاد على شبكة الإنتاج، خصوصاً لشركات كبيرة الحجم.
    { timeout: 20_000, maxWait: 10_000 },
  );

  res.status(201).json(result);
};

export const deleteAccount: RequestHandler = async (req, res) => {
  const existing = await prisma.account.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) throw notFound("الحساب غير موجود");
  const [children, lines] = await Promise.all([
    prisma.account.count({ where: { parentId: existing.id } }),
    prisma.journalEntryLine.count({ where: { accountId: existing.id } }),
  ]);
  if (children || lines) {
    const reasons = [children ? `${children} حسابات فرعية` : "", lines ? `${lines} حركات أو قيود مرتبطة` : ""].filter(Boolean).join(" و");
    throw badRequest(`لا يمكن حذف الحساب لوجود ${reasons}. استخدم الأرشفة بدلاً من الحذف.`, { children, journalLines: lines });
  }
  await prisma.account.delete({ where: { id: existing.id } });
  res.status(204).send();
};
