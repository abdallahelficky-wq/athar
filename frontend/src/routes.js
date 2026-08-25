/**
 * بنّاءو المسارات المركزية للتطبيق — نقطة واحدة لصياغة أي رابط داخلي بدل تكرار القوالب النصية
 * في كل ملف، حتى يبقى مخطط الـ URL (اسم القسم/التبويب الافتراضي) متسقاً في كل مكان يُستخدَم فيه.
 * كل مسار حقيقي وقابل للنقر بـ Ctrl/Cmd/الزر الأوسط لفتحه في تبويب جديد (عبر <Link>/<a> حقيقية).
 */
export const routes = {
  dashboard: () => "/dashboard",
  sales: (tab = "invoices") => `/sales/${tab}`,
  purchases: (tab = "suppliers") => `/purchases/${tab}`,
  inventory: (tab = "items") => `/inventory/${tab}`,
  fixedAssets: (tab = "register") => `/fixedAssets/${tab}`,
  accounts: (tab = "journal") => `/accounts/${tab}`,
  hr: (tab = "dashboard") => `/hr/${tab}`,
  reports: (tab = "trial") => `/reports/${tab}`,
  settings: (tab = "companies") => `/settings/${tab}`,
  /** كشف حساب الأستاذ لحساب معيّن — يُستخدَم من كل روابط "عرض في شجرة الحسابات" المتفرّقة
   * (العملاء/الموردون/الموظفون) والبحث السريع، حتى لا يتكرر بناء الرابط في كل ملف على حدة. */
  accountLedger: (accountId) => (accountId ? `/accounts/ledger?accountId=${encodeURIComponent(accountId)}` : "/accounts/ledger"),
  /** فتح قيد يومية محدَّد من داخل شاشة "القيود اليومية" الحقيقية بكامل مكوّنات النظام (لا صفحة
   * عرض منفصلة) — يُستخدَم من رابط كشف حساب الأستاذ. JournalModule يقرأ entryId ويفتح نافذة
   * التعديل/العرض المناسبة تلقائياً فور التحميل (راجع التعليق هناك). */
  journalEntry: (entryId) => (entryId ? `/accounts/journal?entryId=${encodeURIComponent(entryId)}` : "/accounts/journal"),
};
