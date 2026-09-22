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
  stables: (tab = "overview") => `/stables/${tab}`,
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
  /** كشف حساب عميل لشركة مُحدَّدة (شركة الفاتورة/المردود التي فُتح الرابط منها، لا بالضرورة الشركة
   * النشطة حالياً في مُبدّل الشركات) — يفتح تبويب العملاء ويعرض النافذة تلقائياً (راجع CustomersTab.jsx).
   * from/to اختياريان؛ يمرّرهما الطرف المستدعي (مثلاً بداية السنة المالية الحالية حتى اليوم). */
  customerStatement: (customerId, companyId, from, to) => {
    const params = new URLSearchParams({ statementCustomerId: customerId });
    if (companyId) params.set("statementCompanyId", companyId);
    if (from) params.set("statementFrom", from);
    if (to) params.set("statementTo", to);
    return `/sales/customers?${params.toString()}`;
  },
  /** كرت صنف للقراءة فقط لشركة مُحدَّدة — يفتح تبويب الأصناف ويعرض الكرت تلقائياً (راجع ItemsTab.jsx). */
  itemCard: (itemId, companyId) => {
    const params = new URLSearchParams({ itemCardId: itemId });
    if (companyId) params.set("itemCardCompanyId", companyId);
    return `/inventory/items?${params.toString()}`;
  },
  /** يفتح قائمة فواتير المبيعات مُفلترة برقم فاتورة محدَّد عبر البحث السريع الموجود أصلاً — يُستخدَم
   * لربط حركة مخزون ناتجة عن فاتورة بمستندها (راجع GET /sales-invoices/search). */
  invoiceByNumber: (invoiceNumber) => `/sales/invoices?q=${encodeURIComponent(invoiceNumber)}`,
};

