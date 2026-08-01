import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { verifyPassword } from "../../lib/password";
import { badRequest, forbidden, notFound } from "../../lib/httpError";
import { extractJournalEntryFromDocument } from "../../lib/claudeVision";
import { buildObjectKey, uploadObject, getPresignedGetUrl } from "../../lib/storage";
import { reserveEntryNumber } from "../../lib/journalPosting";

const BALANCE_EPSILON = 0.01;

export interface JournalLineInput {
  accountId: string;
  costCenterId?: string | null;
  department?: string | null;
  description?: string | null;
  debit: number;
  credit: number;
  customerId?: string | null;
  supplierId?: string | null;
  employeeId?: string | null;
}

export interface JournalEntryInput {
  companyId: string;
  date: Date;
  memo?: string;
  lines: JournalLineInput[];
}

/** القاعدة الصارمة المطلوبة صراحة في القسم 3 من المستند: مجموع المدين = مجموع الدائن قبل أي حفظ */
function assertBalanced(lines: JournalLineInput[]) {
  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);

  if (lines.length < 2) throw badRequest("القيد يجب أن يحتوي على سطرين على الأقل");
  if (totalDebit <= 0) throw badRequest("إجمالي القيد يجب أن يكون أكبر من صفر");
  if (Math.abs(totalDebit - totalCredit) > BALANCE_EPSILON) {
    throw badRequest("القيد غير متوازن: مجموع المدين لا يساوي مجموع الدائن", { totalDebit, totalCredit });
  }
}

async function assertReferencesBelongToTenant(tenantId: string, input: JournalEntryInput) {
  const company = await prisma.company.findFirst({ where: { id: input.companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");

  const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds }, tenantId, companyId: input.companyId, isPosting: true, isArchived: false, isActive: true },
  });
  if (accounts.length !== accountIds.length) throw badRequest("أحد الحسابات المستخدمة لا ينتمي إلى شجرة الشركة أو ليس حساب ترحيل نشطاً");

  const costCenterIds = [...new Set(input.lines.map((l) => l.costCenterId).filter(Boolean))] as string[];
  if (costCenterIds.length) {
    const costCenters = await prisma.costCenter.findMany({ where: { id: { in: costCenterIds }, tenantId } });
    if (costCenters.length !== costCenterIds.length) throw badRequest("أحد مراكز التكلفة المستخدمة غير موجود");
  }
}

function toLineCreateData(lines: JournalLineInput[]) {
  return lines.map((l) => ({
    accountId: l.accountId,
    costCenterId: l.costCenterId || null,
    department: l.department || null,
    description: l.description || null,
    debit: new Prisma.Decimal(l.debit || 0),
    credit: new Prisma.Decimal(l.credit || 0),
    customerId: l.customerId || null,
    supplierId: l.supplierId || null,
    employeeId: l.employeeId || null,
  }));
}

const entryInclude = {
  lines: { include: { account: true, costCenter: true } },
  company: true,
} satisfies Prisma.JournalEntryInclude;

export interface JournalEntryFilters {
  companyId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  entryNumber?: string;
  accountId?: string;
  amount?: number;
  amountMin?: number;
  amountMax?: number;
  status?: "saved" | "posted";
}

/**
 * محرك بحث/فلترة شاشة القيود: كل المعايير (بيان، تاريخ، رقم قيد، حساب، حالة القيد) تُطبَّق كشرط
 * WHERE واحد (AND ضمني بين كل الحقول)، ما عدا المبلغ — لأن "إجمالي القيد" ليس عموداً مخزَّناً بل
 * مجموع أسطر مرتبطة، فيُحسَب بعد الجلب من قاعدة البيانات ويُفلتَر في الذاكرة (حجم بيانات هذا
 * التطبيق لكل شركة معقول لهذا النهج، ويتفادى استعلام SQL مجمَّع أعقد لفائدة هامشية).
 */
export async function listJournalEntries(tenantId: string, filters: JournalEntryFilters) {
  const entries = await prisma.journalEntry.findMany({
    where: {
      tenantId,
      companyId: filters.companyId || undefined,
      status: filters.status || undefined,
      date: {
        gte: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
        lte: filters.dateTo ? new Date(filters.dateTo) : undefined,
      },
      // AND صريح بمصفوفة (بدل تكرار مفتاح OR على مستوى الكائن نفسه، وهو ما كان سيُسبِّب تجاوز أحد
      // شرطي OR للآخر لو طُبِّقا معاً) — كل عنصر هنا شرط OR مستقل يُضاف فقط لو طُلب معياره فعلياً.
      AND: [
        ...(filters.search
          ? [{ OR: [{ memo: { contains: filters.search, mode: "insensitive" as const } }, { id: filters.search }] }]
          : []),
        ...(filters.entryNumber
          ? [
              {
                OR: [
                  { entryNumber: { contains: filters.entryNumber, mode: "insensitive" as const } },
                  { id: { contains: filters.entryNumber, mode: "insensitive" as const } },
                ],
              },
            ]
          : []),
      ],
      ...(filters.accountId ? { lines: { some: { accountId: filters.accountId } } } : {}),
    },
    include: entryInclude,
    // الأحدث إنشاءً يظهر أولاً دائماً؛ id كفاصل حاسم يجعل الترتيب ثابتاً حتى لو تشابه وقت الإنشاء.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  const filtered =
    filters.amount == null && filters.amountMin == null && filters.amountMax == null
      ? entries
      : entries.filter((e) => {
          const total = e.lines.reduce((s, l) => s + Number(l.debit), 0);
          if (filters.amount != null && Math.abs(total - filters.amount) > BALANCE_EPSILON) return false;
          if (filters.amountMin != null && total < filters.amountMin - BALANCE_EPSILON) return false;
          if (filters.amountMax != null && total > filters.amountMax + BALANCE_EPSILON) return false;
          return true;
        });

  // استعلام واحد إضافي (مُفهرَس عبر @@index([tenantId, reversalOfEntryId])) ليعرف كل سطر في
  // القائمة مسبقاً هل تم عكسه لاحقاً بقيد آخر أم لا — بدل استعلام منفصل لكل قيد (N+1)، دون الحاجة
  // لتحديث أي عمود على القيد الأصلي نفسه (انظر تعليق reversalOfEntryId في schema.prisma).
  const reversals = await prisma.journalEntry.findMany({
    where: { tenantId, reversalOfEntryId: { in: filtered.map((e) => e.id) } },
    select: { id: true, reversalOfEntryId: true },
  });
  const reversedByMap = new Map(reversals.map((r) => [r.reversalOfEntryId as string, r.id]));

  return filtered.map((e) => ({ ...e, reversedByEntryId: reversedByMap.get(e.id) || null }));
}

export async function getJournalEntry(tenantId: string, id: string) {
  const entry = await prisma.journalEntry.findFirst({ where: { id, tenantId }, include: entryInclude });
  if (!entry) throw notFound("القيد غير موجود");

  const [mirrorEntry, reversalOfEntry, reversedByEntry] = await Promise.all([
    resolveLinkedEntry(tenantId, entry.mirrorEntryId),
    resolveLinkedEntry(tenantId, entry.reversalOfEntryId),
    resolveLinkedEntryBy(tenantId, "reversalOfEntryId", entry.id),
  ]);

  return { ...entry, mirrorEntry, reversalOfEntry, reversedByEntry };
}

/** يحل مرجعاً حراً (id) يدوياً (بلا include صريح، بنفس أسلوب sourceId/sourceModule) لعرض ملخص القيد المرتبط، أياً كان نوع الربط (مرآة بين شركات أو عكس قيد) */
async function resolveLinkedEntry(tenantId: string, linkedEntryId: string | null) {
  if (!linkedEntryId) return null;
  const linked = await prisma.journalEntry.findFirst({
    where: { id: linkedEntryId, tenantId },
    include: { company: true },
  });
  if (!linked) return null;
  return {
    id: linked.id,
    companyId: linked.companyId,
    companyName: linked.company.shortName || linked.company.name,
    date: linked.date,
    memo: linked.memo,
    status: linked.status,
  };
}

/** عكس resolveLinkedEntry: يبحث عن القيد الذي يشير *هو* لهذا القيد عبر عمود معيّن (مثال: reversalOfEntryId) — يُستخدَم لمعرفة هل قيد ما تم عكسه لاحقاً دون أي عمود مقابل يُحدَّث على القيد الأصلي نفسه */
async function resolveLinkedEntryBy(tenantId: string, field: "reversalOfEntryId", targetId: string) {
  const linked = await prisma.journalEntry.findFirst({
    where: { tenantId, [field]: targetId },
    include: { company: true },
  });
  if (!linked) return null;
  return {
    id: linked.id,
    companyId: linked.companyId,
    companyName: linked.company.shortName || linked.company.name,
    date: linked.date,
    memo: linked.memo,
    status: linked.status,
  };
}

/**
 * تُنشئ (أو تُعيد) داخل شجرة `ownerCompanyId` حساب "ذمم بين الشركات" الممثّل لشركة
 * `forCompanyId`. تُفضَّل المطابقة عبر
 * intercompanyCompanyId المُعرَّف صراحة (بنية FK، صامدة أمام إعادة تسمية الشركة لاحقاً)، وإن لم
 * يوجد تُنشأ تلقائياً حساباً جديداً باسم مُشتق — طبقاً للتفويض الصريح المسبق من المستخدم بالإنشاء
 * التلقائي عند عدم وجود هذه الحسابات في شجرة الحسابات.
 */
export async function ensureIntercompanyAccount(tenantId: string, ownerCompanyId: string, forCompanyId: string) {
  if (ownerCompanyId === forCompanyId) throw badRequest("لا يمكن إنشاء حساب ربط للشركة مع نفسها");
  const [ownerCompany, company] = await Promise.all([
    prisma.company.findFirst({ where: { id: ownerCompanyId, tenantId } }),
    prisma.company.findFirst({ where: { id: forCompanyId, tenantId } }),
  ]);
  if (!ownerCompany || !company) throw badRequest("إحدى شركتي الربط غير موجودة ضمن مستأجرك");

  const existingByTag = await prisma.account.findFirst({
    where: { tenantId, companyId: ownerCompanyId, intercompanyCompanyId: forCompanyId },
  });
  if (existingByTag) return existingByTag;

  const name = `ذمم بين الشركات - ${company.shortName || company.name}`;
  const existingByName = await prisma.account.findFirst({ where: { tenantId, companyId: ownerCompanyId, name } });
  if (existingByName) {
    return prisma.account.update({ where: { id: existingByName.id }, data: { intercompanyCompanyId: forCompanyId } });
  }

  const parent = await prisma.account.findFirst({
    where: { tenantId, companyId: ownerCompanyId, code: "113000000", isPosting: false, isArchived: false },
  });
  if (!parent) throw badRequest(`حساب التجميع "الذمم المدينة الأخرى" غير موجود في شجرة ${ownerCompany.name}`);

  const siblings = await prisma.account.findMany({
    where: { tenantId, companyId: ownerCompanyId, code: { startsWith: "1139" } },
    select: { code: true },
  });
  const usedCodes = new Set(siblings.map((account) => account.code));
  let sequence = 1;
  while (usedCodes.has(`1139${String(sequence).padStart(5, "0")}`)) sequence += 1;

  return prisma.account.create({
    data: {
      tenantId, companyId: ownerCompanyId, parentId: parent.id, name,
      nameEn: `Intercompany Receivable - ${company.shortName || company.name}`,
      type: "asset", intercompanyCompanyId: forCompanyId,
      code: `1139${String(sequence).padStart(5, "0")}`, level: 4, isPosting: true,
    },
  });
}

/**
 * تُعِدّ اقتراح "قيد المرآة" في شركة أخرى: تحدّد سطر "الطرف الآخر" تلقائياً (الحساب الممثّل للشركة
 * المصدر داخل شجرة حسابات الشركة الهدف) بعكس الاتجاه (مدين↔دائن)، وتترك سطراً آخر فارغاً ليختار
 * المستخدم منه الحساب الفعلي يدوياً (لأنه يختلف بحسب طبيعة العملية ولا يمكن تخمينه). عند عدم وجود
 * سطر مرتبط صراحة بحساب الشركة الهدف (وهو المتوقع أول مرة يُنشأ فيها قيد مرآة بين شركتين، قبل أن
 * توجد الحسابات المُعلَّمة)، تُستخدَم القيمة الإجمالية للقيد كبديل مع الإشارة لذلك عبر detected:false.
 */
export async function getMirrorSuggestion(tenantId: string, entryId: string, targetCompanyId: string) {
  const entry = await prisma.journalEntry.findFirst({ where: { id: entryId, tenantId }, include: entryInclude });
  if (!entry) throw notFound("القيد غير موجود");
  if (entry.status !== "posted") throw badRequest("لا يمكن إنشاء قيد مرآة إلا لقيد مرحّل");
  if (entry.companyId === targetCompanyId) throw badRequest("اختر شركة مختلفة عن شركة القيد الأصلي");

  const targetCompany = await prisma.company.findFirst({ where: { id: targetCompanyId, tenantId } });
  if (!targetCompany) throw badRequest("الشركة المستهدفة غير موجودة ضمن مستأجرك");

  const sourceSideAccountForTarget = await ensureIntercompanyAccount(tenantId, targetCompanyId, entry.companyId);
  await ensureIntercompanyAccount(tenantId, entry.companyId, targetCompanyId);

  const totalDebit = entry.lines.reduce((s, l) => s + Number(l.debit), 0);
  const linkedLine = entry.lines.find((l) => l.account.intercompanyCompanyId === targetCompanyId);

  let autoSide: "debit" | "credit";
  let amount: number;
  if (linkedLine) {
    amount = Number(linkedLine.debit) || Number(linkedLine.credit);
    const originalSideWasDebit = Number(linkedLine.debit) > 0;
    autoSide = originalSideWasDebit ? "credit" : "debit";
  } else {
    amount = totalDebit;
    autoSide = "credit";
  }

  const autoLine = {
    accountId: sourceSideAccountForTarget.id,
    accountName: sourceSideAccountForTarget.name,
    debit: autoSide === "debit" ? amount : 0,
    credit: autoSide === "credit" ? amount : 0,
    locked: true,
  };
  const manualLine = {
    accountId: null,
    accountName: null,
    debit: autoSide === "credit" ? amount : 0,
    credit: autoSide === "debit" ? amount : 0,
    locked: false,
  };

  return {
    targetCompanyId,
    date: entry.date,
    memo: entry.memo,
    lines: [autoLine, manualLine],
    detected: !!linkedLine,
  };
}

/**
 * تُنشئ قيد المرآة فعلياً في الشركة المستهدفة كقيد "محفوظ" (غير مرحّل تلقائياً أبداً، ليراجعه
 * المستخدم قبل الترحيل) وتربطه بالقيد الأصلي تبادلياً عبر mirrorEntryId على القيدين معاً، وتحجز
 * له رقماً تسلسلياً ضمن شركة الهدف، كل ذلك ضمن معاملة واحدة.
 */
export async function createMirrorJournalEntry(
  tenantId: string,
  userId: string,
  sourceEntryId: string,
  input: { targetCompanyId: string; date: Date; memo?: string; lines: JournalLineInput[] },
) {
  const source = await prisma.journalEntry.findFirst({ where: { id: sourceEntryId, tenantId } });
  if (!source) throw notFound("القيد الأصلي غير موجود");
  if (source.mirrorEntryId) throw badRequest("لهذا القيد بالفعل قيد مرآة مرتبط به");
  if (source.companyId === input.targetCompanyId) throw badRequest("اختر شركة مختلفة عن شركة القيد الأصلي");

  assertBalanced(input.lines);
  await assertReferencesBelongToTenant(tenantId, {
    companyId: input.targetCompanyId,
    date: input.date,
    memo: input.memo,
    lines: input.lines,
  });

  return prisma.$transaction(async (tx) => {
    const entryNumber = await reserveEntryNumber(tx, tenantId, input.targetCompanyId);
    const mirror = await tx.journalEntry.create({
      data: {
        tenantId,
        companyId: input.targetCompanyId,
        date: input.date,
        memo: input.memo,
        status: "saved",
        entryNumber,
        sourceModule: "manual",
        createdBy: userId,
        mirrorEntryId: sourceEntryId,
        lines: { create: toLineCreateData(input.lines) },
      },
      include: entryInclude,
    });
    await tx.journalEntry.update({ where: { id: sourceEntryId }, data: { mirrorEntryId: mirror.id } });
    return mirror;
  });
}

export async function createJournalEntry(
  tenantId: string,
  userId: string,
  input: JournalEntryInput & { post?: boolean },
) {
  assertBalanced(input.lines);
  await assertReferencesBelongToTenant(tenantId, input);

  return prisma.$transaction(async (tx) => {
    const entryNumber = await reserveEntryNumber(tx, tenantId, input.companyId);
    return tx.journalEntry.create({
      data: {
        tenantId,
        companyId: input.companyId,
        date: input.date,
        memo: input.memo,
        status: input.post ? "posted" : "saved",
        entryNumber,
        sourceModule: "manual",
        createdBy: userId,
        lines: { create: toLineCreateData(input.lines) },
      },
      include: entryInclude,
    });
  });
}

export async function updateJournalEntry(tenantId: string, id: string, input: JournalEntryInput) {
  const existing = await prisma.journalEntry.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("القيد غير موجود");
  if (existing.status === "posted") {
    throw badRequest("لا يمكن تعديل قيد مرحّل مباشرة — استخدم عكس القيد لتصحيحه");
  }

  assertBalanced(input.lines);
  await assertReferencesBelongToTenant(tenantId, input);

  return prisma.$transaction(async (tx) => {
    await tx.journalEntryLine.deleteMany({ where: { journalEntryId: id } });
    return tx.journalEntry.update({
      where: { id },
      data: {
        companyId: input.companyId,
        date: input.date,
        memo: input.memo,
        lines: { create: toLineCreateData(input.lines) },
      },
      include: entryInclude,
    });
  });
}

export async function deleteJournalEntry(tenantId: string, id: string) {
  const existing = await prisma.journalEntry.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("القيد غير موجود");
  if (existing.status === "posted") {
    throw badRequest("لا يمكن حذف قيد مرحّل مباشرة — استخدم عكس القيد لتصحيحه");
  }
  await prisma.journalEntry.delete({ where: { id } });
}

export async function postJournalEntry(tenantId: string, id: string) {
  const existing = await prisma.journalEntry.findFirst({ where: { id, tenantId }, include: entryInclude });
  if (!existing) throw notFound("القيد غير موجود");
  if (existing.status === "posted") throw badRequest("القيد مرحّل بالفعل");

  assertBalanced(
    existing.lines.map((l) => ({ accountId: l.accountId, debit: Number(l.debit), credit: Number(l.credit) })),
  );

  return prisma.journalEntry.update({ where: { id }, data: { status: "posted" }, include: entryInclude });
}

/**
 * "عكس القيد" — لا تُعدِّل أو تُرحِّل/تفك ترحيل القيد الأصلي إطلاقاً، بل تُنشئ قيداً جديداً منفصلاً
 * بنفس بنود القيد الأصلي تماماً (الحساب، مركز التكلفة، القسم، الوصف الخاص بكل سطر، البيان العام)
 * لكن بعكس المدين/الدائن على كل سطر — فيبقى متوازناً تلقائياً بلا حاجة لإعادة التحقق. يُحفَظ دائماً
 * كقيد "محفوظ" (غير مرحّل) ليراجعه المستخدم قبل الترحيل — هذا هو مسار التصحيح الوحيد لقيد مرحّل
 * مقفل، بعد إلغاء "فك الترحيل" من واجهة القيود اليدوية. الربط أحادي الاتجاه (reversalOfEntryId على
 * القيد الجديد فقط) بدل تحديث الطرفين معاً كما في mirrorEntryId — أبسط هنا لأن معرفة "هل قيد ما تم
 * عكسه لاحقاً" ممكنة بالبحث العكسي (انظر resolveLinkedEntryBy)، فلا داعي لمعاملة تلمس صفّين.
 */
export async function reverseJournalEntry(tenantId: string, userId: string, id: string, date: Date) {
  const existing = await prisma.journalEntry.findFirst({ where: { id, tenantId }, include: entryInclude });
  if (!existing) throw notFound("القيد غير موجود");
  if (existing.status !== "posted") throw badRequest("لا يمكن عكس إلا قيداً مرحّلاً");

  const alreadyReversed = await prisma.journalEntry.findFirst({ where: { tenantId, reversalOfEntryId: id } });
  if (alreadyReversed) throw badRequest("تم عكس هذا القيد مسبقاً بقيد آخر");

  const reversedLines: JournalLineInput[] = existing.lines.map((l) => ({
    accountId: l.accountId,
    costCenterId: l.costCenterId,
    department: l.department,
    description: l.description,
    debit: Number(l.credit),
    credit: Number(l.debit),
    customerId: l.customerId,
    supplierId: l.supplierId,
    employeeId: l.employeeId,
  }));

  return prisma.$transaction(async (tx) => {
    const entryNumber = await reserveEntryNumber(tx, tenantId, existing.companyId);
    return tx.journalEntry.create({
      data: {
        tenantId,
        companyId: existing.companyId,
        date,
        memo: existing.memo,
        status: "saved",
        entryNumber,
        sourceModule: "manual",
        createdBy: userId,
        reversalOfEntryId: existing.id,
        lines: { create: toLineCreateData(reversedLines) },
      },
      include: entryInclude,
    });
  });
}

/**
 * تُبقى هذه الوظيفة موجودة في الخادم لأغراض تصحيح استثنائية محمية بالرقم السري، لكنها لم تعد
 * مُتاحة من واجهة شاشة القيود اليدوية — دورة الحياة الجديدة (القسم 4 من الطلب) تشترط أن يُقفَل
 * القيد المرحّل تماماً بلا أي تعديل مباشر، وتُحيل أي تصحيح لآلية "عكس القيد" حصراً بدل فك الترحيل
 * وإعادة التعديل، حتى لا يُلتَف على قاعدة "لا تعديل بعد الترحيل" عبر فك الترحيل ثم التعديل ثم إعادة الترحيل.
 */
export async function unpostJournalEntry(tenantId: string, id: string, userId: string, pin: string) {
  const entry = await prisma.journalEntry.findFirst({ where: { id, tenantId } });
  if (!entry) throw notFound("القيد غير موجود");
  if (entry.status !== "posted") throw badRequest("القيد ليس مرحّلاً أصلاً");

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const validPin = await verifyPassword(pin, tenant.unlockPin);
  if (!validPin) throw forbidden("الرقم السري غير صحيح");

  const [updated] = await prisma.$transaction([
    prisma.journalEntry.update({ where: { id }, data: { status: "saved" }, include: entryInclude }),
    prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action: "journal_entry.unpost",
        entityType: "JournalEntry",
        entityId: id,
        metadata: { previousStatus: "posted" },
      },
    }),
  ]);

  return updated;
}

export interface ImportRow {
  date: string;
  memo?: string;
  debitAccountName: string;
  debitAmount: number;
  creditAccountName: string;
  creditAmount: number;
}

export async function importJournalEntries(tenantId: string, userId: string, companyId: string, rows: ImportRow[]) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");

  const accounts = await prisma.account.findMany({
    where: { tenantId, companyId, isPosting: true, isArchived: false, isActive: true },
  });
  const accountByName = new Map(accounts.map((a) => [a.name, a]));

  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const debitAccount = accountByName.get(row.debitAccountName);
    const creditAccount = accountByName.get(row.creditAccountName);
    const debitAmt = Number(row.debitAmount || 0);
    const creditAmt = Number(row.creditAmount || 0);

    if (
      !row.date ||
      !debitAccount ||
      !creditAccount ||
      debitAmt <= 0 ||
      Math.abs(debitAmt - creditAmt) > BALANCE_EPSILON
    ) {
      skipped++;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const entryNumber = await reserveEntryNumber(tx, tenantId, companyId);
      await tx.journalEntry.create({
        data: {
          tenantId,
          companyId,
          date: new Date(row.date),
          memo: row.memo,
          status: "posted",
          entryNumber,
          sourceModule: "manual",
          createdBy: userId,
          lines: {
            create: [
              { accountId: debitAccount.id, debit: new Prisma.Decimal(debitAmt), credit: new Prisma.Decimal(0) },
              { accountId: creditAccount.id, debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(creditAmt) },
            ],
          },
        },
      });
    });
    imported++;
  }

  return { imported, skipped };
}

/**
 * إنشاء قيد يومية "محفوظ" (غير مرحّل) من مستند (صورة/PDF) بمساعدة الذكاء الاصطناعي — يقرأ Claude
 * المستند ويقترح حساباً مديناً ودائناً من شجرة حسابات هذا المستأجر فعلياً، ثم يُنشأ القيد بحالة
 * saved (لا يُرحَّل أبداً تلقائياً؛ المستخدم يراجعه ويعدّله ثم يستخدم /:id/post الحالي صراحة
 * للترحيل، تماماً كأي قيد يدوي آخر). المستند المرفوع يُربَط تلقائياً بالقيد الناتج عبر جدول
 * Attachment بمجرد إنشائه.
 */
export async function createJournalEntryFromDocument(
  tenantId: string,
  userId: string,
  companyId: string,
  file: { buffer: Buffer; mimeType: string; fileName: string },
) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");

  const accounts = await prisma.account.findMany({
    where: { tenantId, companyId, isPosting: true, isArchived: false, isActive: true },
  });
  const extraction = await extractJournalEntryFromDocument(
    file.buffer,
    file.mimeType,
    accounts.map((a) => ({ id: a.id, name: a.name, type: a.type })),
  );

  const accountIds = new Set(accounts.map((a) => a.id));
  if (
    !extraction.suggestedDebitAccountId ||
    !extraction.suggestedCreditAccountId ||
    !accountIds.has(extraction.suggestedDebitAccountId) ||
    !accountIds.has(extraction.suggestedCreditAccountId)
  ) {
    throw badRequest("تعذّر على الذكاء الاصطناعي اقتراح حساب صالح من شجرة حساباتك لهذا المستند، جرّب مستنداً أوضح أو أنشئ القيد يدوياً");
  }
  if (extraction.suggestedDebitAccountId === extraction.suggestedCreditAccountId) {
    throw badRequest("اقترح الذكاء الاصطناعي نفس الحساب مديناً ودائناً معاً، وهذا غير منطقي محاسبياً — راجع المستند وأنشئ القيد يدوياً");
  }
  if (extraction.amount <= 0) {
    throw badRequest("تعذّر على الذكاء الاصطناعي قراءة مبلغ صالح من هذا المستند");
  }

  const lines: JournalLineInput[] = [
    { accountId: extraction.suggestedDebitAccountId, debit: extraction.amount, credit: 0 },
    { accountId: extraction.suggestedCreditAccountId, debit: 0, credit: extraction.amount },
  ];
  assertBalanced(lines);

  const memoParts = [extraction.description || "قيد مقترح من مستند بالذكاء الاصطناعي"];
  if (extraction.partyName) memoParts.push(`— ${extraction.partyName}`);
  if (extraction.vatAmount > 0) memoParts.push(`(شامل ضريبة قيمة مضافة: ${extraction.vatAmount.toFixed(2)} ر.س)`);

  const date = extraction.date && !Number.isNaN(Date.parse(extraction.date)) ? new Date(extraction.date) : new Date();

  const entry = await prisma.$transaction(async (tx) => {
    const entryNumber = await reserveEntryNumber(tx, tenantId, companyId);
    return tx.journalEntry.create({
      data: {
        tenantId,
        companyId,
        date,
        memo: memoParts.join(" "),
        status: "saved",
        entryNumber,
        sourceModule: "ai_document",
        createdBy: userId,
        lines: { create: toLineCreateData(lines) },
      },
      include: entryInclude,
    });
  });

  const fileKey = buildObjectKey(tenantId, "journal_entry", entry.id, file.fileName);
  await uploadObject(fileKey, file.buffer, file.mimeType);
  const attachment = await prisma.attachment.create({
    data: {
      tenantId,
      entityType: "journal_entry",
      entityId: entry.id,
      fileName: file.fileName,
      fileKey,
      fileSize: file.buffer.length,
      mimeType: file.mimeType,
      uploadedBy: userId,
    },
  });

  return {
    entry,
    attachment: { id: attachment.id, fileName: attachment.fileName, fileUrl: await getPresignedGetUrl(fileKey) },
    aiConfidenceNote: extraction.confidenceNote,
  };
}
