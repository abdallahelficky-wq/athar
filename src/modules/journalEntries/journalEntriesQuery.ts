import { Prisma } from "@prisma/client";
import { badRequest } from "../../lib/httpError";
import { SortDir } from "../../lib/keysetPagination";

/**
 * كل المنطق الخالص (بلا أي استدعاء قاعدة بيانات) لمحرك بحث/فلترة/ترتيب/تصدير شاشة القيود — مفصولة
 * عمداً عن journalEntries.service.ts (التي تستورد prisma وتتولى الاستعلامات الفعلية) حتى يمكن
 * اختبار هذا الملف مباشرة بلا أي اتصال بقاعدة بيانات ولا قراءة أي متغيّر بيئة (لا يستورد
 * src/lib/prisma.ts ولا src/config/env.ts، لا مباشرة ولا عبر أي استيراد متسلسل).
 */

export const BALANCE_EPSILON = 0.01;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const EXPORT_SAFETY_CAP = 20_000;

// سطور القيد (بكل علاقاتها) لا تُحمَّل في شاشة القائمة — تُستخدَم فقط عند فتح قيد محدَّد عبر
// getJournalEntry (أو مباشرة قبل فتح نافذة العرض/التعديل/النسخ في الواجهة). _count.lines/totalDebit
// يكفيان لعرض عدد الأسطر والإجمالي في صف القائمة بلا أي JOIN على جدول الأسطر نفسه — لمن يملك صلاحية
// رؤية بيانات الموارد البشرية كما هي (hrView !== false).
export const listEntrySelect = {
  id: true,
  entryNumber: true,
  entrySeq: true,
  date: true,
  memo: true,
  status: true,
  totalDebit: true,
  mirrorEntryId: true,
  reversalOfEntryId: true,
  _count: { select: { lines: true } },
} satisfies Prisma.JournalEntrySelect;

// لمن لا يملك صلاحية رؤية بيانات الموارد البشرية (hrView === false): يجب طيّ أسطر قيود الرواتب/
// التسويات (collapseHrLines في hrRedaction.ts) قبل حساب عدد الأسطر الظاهر وإخراج البيان المحذوف منه
// الاسم — فتُجلَب حقول الأسطر النطيّة (scalar فقط، بلا أي علاقة متداخلة) بدل _count، ويُحسَب العدد
// الظاهر من lines.length بعد الطيّ، لا من _count الخام.
export const listEntrySelectWithThinLines = {
  id: true,
  entryNumber: true,
  entrySeq: true,
  date: true,
  memo: true,
  status: true,
  totalDebit: true,
  mirrorEntryId: true,
  reversalOfEntryId: true,
  sourceModule: true,
  lines: {
    select: {
      id: true,
      accountId: true,
      debit: true,
      credit: true,
      employeeId: true,
      employeeAdvanceId: true,
      costCenterId: true,
      departmentId: true,
      department: true,
      branchId: true,
    },
  },
} satisfies Prisma.JournalEntrySelect;

export interface JournalEntryFilters {
  companyId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  entryNumber?: string;
  accountId?: string;
  branchId?: string;
  amount?: number;
  amountMin?: number;
  amountMax?: number;
  status?: "saved" | "posted";
  /** false لغير أدوار الموارد البشرية: قيود الرواتب والتسويات تُعرَض مطويّة — راجع redactHrEntries */
  hrView?: boolean;
}

export type JournalEntrySortBy = "date" | "entrySeq" | "amount";

export interface JournalEntryListOptions extends JournalEntryFilters {
  /** معرّف آخر قيد في الصفحة السابقة — غيابه يعني الصفحة الأولى. */
  cursor?: string;
  take?: number;
  sortBy?: JournalEntrySortBy;
  sortDir?: SortDir;
}

/**
 * فلتر «رقم القيد»: الرقم الظاهر يُطابَق جزئياً (contains)، والمعرّف الداخلي يُطابَق **حرفياً فقط** — معرّف عشوائي
 * يحتوي "914" لا يجعل القيد J00149 نتيجةً لبحث "914". مصدر واحد للمسار المرقّم والمسار القديم والتصدير معاً.
 */
export function entryNumberCondition(entryNumber: string): Prisma.JournalEntryWhereInput {
  return {
    OR: [
      { entryNumber: { contains: entryNumber, mode: "insensitive" } },
      { id: entryNumber },
    ],
  };
}

/**
 * نفس شرط WHERE بالضبط يُستخدَم لشاشة القائمة المرقّمة صفحات وللتصدير الكامل (CSV) معاً — فلا
 * يُمكن لأي منهما أن يرى فلترة مختلفة عن الآخر على نفس المعايير.
 *
 * resolvedAccountIds: قائمة مُحضَّرة مسبقاً (الحساب المطلوب + كل حساباته الفرعية تكرارياً — توسعة
 * غير نقية تحتاج استعلامات DB متتالية، فتُنجَز في الطبقة التي تستورد prisma ثم تُمرَّر هنا جاهزة)؛
 * تُستبدَل بـfilters.accountId الخام لو غابت. branchId يُطابَق على *نفس* السطر الذي يطابق الحساب (لا
 * سطرين مستقلّين) — lines.some واحد يحمل كل شروط السطر معاً، تماماً كما تتوقّعه شاشة القيود (قيد له
 * سطر على الحساب المطلوب وسطر آخر على الفرع المطلوب لا يُعامَل كمطابقة لكليهما).
 */
export function buildJournalEntryWhere(
  tenantId: string,
  filters: JournalEntryFilters,
  resolvedAccountIds?: string[],
): Prisma.JournalEntryWhereInput {
  const lineFilter: Record<string, unknown> = {
    ...(resolvedAccountIds ? { accountId: { in: resolvedAccountIds } } : filters.accountId ? { accountId: filters.accountId } : {}),
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
  };

  return {
    tenantId,
    companyId: filters.companyId || undefined,
    status: filters.status || undefined,
    date: {
      gte: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
      lte: filters.dateTo ? new Date(filters.dateTo) : undefined,
    },
    // AND صريح بمصفوفة (بدل تكرار مفتاح OR على مستوى الكائن نفسه، وهو ما كان سيُسبِّب تجاوز أحد
    // شرطي OR للآخر لو طُبِّقا معاً) — كل عنصر هنا شرط OR مستقل يُضاف فقط لو طُلب معياره فعلياً.
    // فلتر المبلغ أصبح شرط WHERE حقيقي على totalDebit (عمود مخزَّن فعلياً) بدل فلترة في الذاكرة
    // بعد الجلب — وهو ما كان يمنع الترقيم الصحيح للصفحات (صفحة من N صف قد تُصبح أقل من N بعد
    // الفلترة اللاحقة، بينما توجد نتائج مطابقة أخرى بعدها لم تُجلَب أصلاً). هذا لا يتأثر بطيّ قيود
    // الموارد البشرية (collapseHrLines يحافظ على إجمالي المدين كما هو، يُجمِّع الأسطر فقط).
    AND: [
      // المستدعي (listJournalEntries) يُمرِّر search=undefined هنا أصلاً لو hrView===false، فلا داعي
      // لتكرار ذلك الشرط هنا — راجع التعليق هناك لسبب عدم دفع هذا البحث تحديداً لـSQL في تلك الحالة.
      ...(filters.search
        ? [{ OR: [{ memo: { contains: filters.search, mode: "insensitive" as const } }, { id: filters.search }] }]
        : []),
      ...(filters.entryNumber ? [entryNumberCondition(filters.entryNumber)] : []),
      ...(filters.amount != null
        ? [
            {
              totalDebit: {
                gte: new Prisma.Decimal(filters.amount - BALANCE_EPSILON),
                lte: new Prisma.Decimal(filters.amount + BALANCE_EPSILON),
              },
            },
          ]
        : []),
      ...(filters.amountMin != null ? [{ totalDebit: { gte: new Prisma.Decimal(filters.amountMin - BALANCE_EPSILON) } }] : []),
      ...(filters.amountMax != null ? [{ totalDebit: { lte: new Prisma.Decimal(filters.amountMax + BALANCE_EPSILON) } }] : []),
    ],
    ...(Object.keys(lineFilter).length ? { lines: { some: lineFilter } } : {}),
  };
}

/**
 * تعريف كل نمط ترتيب مدعوم كسلسلة مستويات (lexicographic) تنتهي دائماً بـid كفاصل حاسم نهائي —
 * نفس التعريف يُستخدَم لبناء orderBy الفعلي ولبناء شرط buildKeysetWhere معاً، فلا يمكن لأي منهما
 * أن ينحرف عن الآخر. entrySeq قابل لل null (قيود قديمة غير قابلة للتفسير، انظر تعليقه في
 * schema.prisma) — يُعامَل دائماً كآخر الترتيب (nulls last) بصرف النظر عن اتجاه الفرز.
 */
export const SORT_LEVEL_DEFS: Record<JournalEntrySortBy, Array<{ field: string; nullable: boolean }>> = {
  date: [
    { field: "date", nullable: false },
    { field: "entrySeq", nullable: true },
    { field: "id", nullable: false },
  ],
  entrySeq: [
    { field: "entrySeq", nullable: true },
    { field: "id", nullable: false },
  ],
  amount: [
    { field: "totalDebit", nullable: false },
    { field: "id", nullable: false },
  ],
};

export function buildOrderBy(sortBy: JournalEntrySortBy, sortDir: SortDir): Prisma.JournalEntryOrderByWithRelationInput[] {
  return SORT_LEVEL_DEFS[sortBy].map((level) =>
    level.nullable ? { [level.field]: { sort: sortDir, nulls: "last" as const } } : { [level.field]: sortDir },
  ) as Prisma.JournalEntryOrderByWithRelationInput[];
}

/** يرمي خطأ 400 واضحاً لو تجاوز عدد النتائج المطابقة الحدّ الأقصى للتصدير — لا يُقطَع الملف أبداً بصمت. */
export function assertWithinExportCap(matchCount: number, cap: number = EXPORT_SAFETY_CAP): void {
  if (matchCount > cap) {
    throw badRequest(
      `عدد القيود المطابقة (${matchCount}) يتجاوز الحد الأقصى للتصدير (${cap}) — ضيّق نطاق البحث (الشركة/التاريخ/الحالة) ثم أعد المحاولة`,
    );
  }
}

/** يبني ملف CSV نصّياً من صفوف قائمة القيود — دالة خالصة (بلا أي استدعاء قاعدة بيانات) لسهولة اختبارها. */
export function buildJournalEntriesCsv(
  rows: Array<{ entryNumber: string; date: Date; memo: string | null; status: string; totalDebit: Prisma.Decimal | number | string }>,
): string {
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["رقم القيد", "التاريخ", "البيان", "الحالة", "الإجمالي"].map(escape).join(",");
  const body = rows.map((r) =>
    [
      r.entryNumber,
      new Date(r.date).toISOString().slice(0, 10),
      r.memo || "",
      r.status === "posted" ? "مرحّل" : "محفوظ",
      Number(r.totalDebit),
    ]
      .map(escape)
      .join(","),
  );
  return "﻿" + [header, ...body].join("\r\n");
}
