// أحجام صفحة محدَّدة سلفاً فقط — لا حجم حرّ (يمنع طلب صفحة بحجم ضخم يُثقِل قاعدة البيانات).
// مُشترَكة بين أي قائمة بحث/فلترة/ترقيم من جانب الخادم (فواتير المبيعات، مردودات المبيعات...).
export const SEARCH_PAGE_SIZES = [15, 25, 50, 100, 200] as const;

/**
 * ترقيم اختياري لقوائم قديمة كانت تُعيد كل السجلات مصفوفةً (فواتير المشتريات، السندات…): لو أرسل الطلب `page`
 * تُعاد صفحة واحدة مع العدد الكلي وعدّاد الحالات؛ وبدونه يبقى الرد مصفوفة كاملة كما كان — لأن شاشات أخرى (منتقيات،
 * البحث السريع، المردودات) تعتمد على ذلك الشكل. حجم الصفحة من SEARCH_PAGE_SIZES فقط.
 */
export interface ListPageParams {
  page: number;
  pageSize: number;
  q?: string;
  status?: "posted" | "draft";
  /** نطاق تاريخ المستند (YYYY-MM-DD شاملاً) */
  dateFrom?: Date;
  dateTo?: Date;
}

export function parseListPage(query: Record<string, unknown>): ListPageParams | null {
  if (query.page === undefined || query.page === "") return null;
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  const requested = Number(query.pageSize);
  const pageSize = (SEARCH_PAGE_SIZES as readonly number[]).includes(requested) ? requested : 25;
  const q = typeof query.q === "string" && query.q.trim() ? query.q.trim().slice(0, 100) : undefined;
  const status = query.status === "posted" || query.status === "draft" ? query.status : undefined;
  const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00.000Z`) : undefined);
  const dateFrom = day(query.dateFrom);
  const dateToStart = day(query.dateTo);
  const dateTo = dateToStart ? new Date(dateToStart.getTime() + 86_400_000 - 1) : undefined;
  return { page, pageSize, q, status, dateFrom, dateTo };
}
