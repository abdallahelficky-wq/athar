export type SortDir = "asc" | "desc";

export interface KeysetLevel {
  /** اسم الحقل كما يظهر في Prisma where/orderBy. */
  field: string;
  dir: SortDir;
  /** قيمة هذا الحقل في صف المؤشر (cursor) — من نفس الصف الذي انتهت عنده الصفحة السابقة. */
  value: unknown;
  /**
   * هل هذا الحقل قابل لل null بموضع "آخر الترتيب" (nulls last) — بصرف النظر عن asc/desc. خيار
   * مُبسَّط مقصود: لا حاجة فعلية في هذا المشروع لـnulls:"first"، فلا تُبنى تجريدة أعمّ منها.
   */
  nullable?: boolean;
}

/**
 * تبني شرط WHERE (بصيغة Prisma) يطابق كل الصفوف "التالية بعد" صف مؤشر الصفحة تماماً بنفس ترتيب
 * عدّة حقول مُرتَّبة (lexicographic)، مع دعم صريح لحقل واحد أو أكثر قابل لل null بموضع "آخر
 * الترتيب" — وهو بالضبط ما يرفض معامل cursor المدمج في Prisma العمل معه: أي orderBy بـnulls
 * placement "cannot be paged with cursor() and must use limit() and offset()" (توثيق Prisma، orm
 * reference). هذا الحل اليدوي (WHERE عادي بدل معامل cursor) يتجاوز هذا القيد تماماً لأنه لا يستخدم
 * معامل cursor إطلاقاً.
 *
 * الخوارزمية: لكل مستوى i، الصفوف "بعد" المؤشر عند هذا المستوى تحديداً = تساوي كل المستويات الأسبق
 * (j<i) + قيمة "أصغر/أكبر" (حسب الاتجاه) عند المستوى i. القيم الفارغة (nullable) تُعامَل كآخر
 * الترتيب دائماً: لو كانت قيمة المؤشر غير فارغة، فكل الصفوف الفارغة عند هذا الحقل تُعتبَر "بعده"
 * أيضاً (لأنها تأتي بعد كل القيم الفعلية مهما كان الاتجاه)؛ لو كانت قيمة المؤشر نفسها فارغة، فلا
 * يوجد "بعدها" عند هذا المستوى إطلاقاً (هي آخر الترتيب بالفعل) — فقط تُضاف شرط التساوي (= null)
 * للمستويات الأعمق.
 */
export function buildKeysetWhere(levels: KeysetLevel[]): Record<string, unknown> {
  const orBranches: Record<string, unknown>[] = [];

  for (let i = 0; i < levels.length; i += 1) {
    const prefixEquality = levels.slice(0, i).map((level) => ({ [level.field]: level.value }));
    const comparator = lessThanCursorAtLevel(levels[i]);
    if (comparator == null) continue; // لا "بعد" ممكن عند هذا المستوى (مؤشر فارغ وnulls آخر الترتيب)

    orBranches.push(prefixEquality.length > 0 ? { AND: [...prefixEquality, comparator] } : comparator);
  }

  return orBranches.length > 0 ? { OR: orBranches } : {};
}

function lessThanCursorAtLevel(level: KeysetLevel): Record<string, unknown> | null {
  const { field, dir, value, nullable } = level;
  const op = dir === "desc" ? "lt" : "gt";

  if (!nullable) {
    return { [field]: { [op]: value } };
  }

  if (value === null) {
    // المؤشر نفسه فارغ وهو آخر الترتيب بالفعل — لا شيء "بعده" عند هذا المستوى.
    return null;
  }

  // المؤشر له قيمة فعلية: "بعده" = قيمة أصغر/أكبر فعلية، أو أي قيمة فارغة تماماً (تأتي دائماً
  // بعد كل القيم الفعلية في nulls-last، بصرف النظر عن asc/desc).
  return { OR: [{ [field]: { [op]: value } }, { [field]: null }] };
}
