import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listCustomers } from "../../api/customers";
import { listSuppliers } from "../../api/suppliers";
import { listSalesInvoices } from "../../api/salesInvoices";
import { listPurchaseInvoices } from "../../api/purchaseInvoices";

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

const MAX_PER_GROUP = 5;

/**
 * بحث سريع حقيقي (لا حقل زخرفي) — نطاقه محدود عمداً بأربعة كيانات فعلية موجودة عبر الـ APIs
 * الحالية بلا أي endpoint جديد: العملاء والموردون (بالاسم) وفواتير المبيعات/المشتريات (برقم
 * الفاتورة)، عبر جلب قوائم الشركة الأربع مرة واحدة عند فتح البحث ثم الفلترة محلياً مع كل حرف —
 * وليس بحثاً شاملاً عبر كل شاشات النظام. النتيجة قابلة للنقر فعلياً: عميل/مورد ← كشف حسابه في
 * شجرة الحسابات (نفس مسار "عرض في شجرة الحسابات" الموجود أصلاً)، فاتورة ← شاشة فواتيرها مباشرة.
 */
export default function QuickSearch({ companyId, onViewAccount, onGoInvoices }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pool, setPool] = useState(null);
  const rootRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKeyDown = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    setPool(null);
  }, [companyId]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2 || !companyId) { setOpen(q.length > 0); return undefined; }
    debounceRef.current = setTimeout(() => {
      setOpen(true);
      if (pool) return;
      setLoading(true);
      Promise.all([
        listCustomers(companyId).catch(() => []),
        listSuppliers(companyId).catch(() => []),
        listSalesInvoices(companyId).catch(() => []),
        listPurchaseInvoices(companyId).catch(() => []),
      ]).then(([customers, suppliers, salesInvoices, purchaseInvoices]) => {
        setPool({ customers, suppliers, salesInvoices, purchaseInvoices });
        setLoading(false);
      });
    }, 300);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, companyId]);

  const q = query.trim().toLowerCase();
  const matches = (text) => (text || "").toLowerCase().includes(q);

  const results = pool && q.length >= 2 ? {
    customers: pool.customers.filter((c) => matches(c.name)).slice(0, MAX_PER_GROUP),
    suppliers: pool.suppliers.filter((s) => matches(s.name)).slice(0, MAX_PER_GROUP),
    salesInvoices: pool.salesInvoices.filter((i) => matches(i.invoiceNumber)).slice(0, MAX_PER_GROUP),
    purchaseInvoices: pool.purchaseInvoices.filter((i) => matches(i.invoiceNumber)).slice(0, MAX_PER_GROUP),
  } : null;
  const totalResults = results
    ? results.customers.length + results.suppliers.length + results.salesInvoices.length + results.purchaseInvoices.length
    : 0;

  const selectAccount = (accountId) => {
    setOpen(false);
    setQuery("");
    onViewAccount(accountId);
  };
  const selectInvoices = (kind) => {
    setOpen(false);
    setQuery("");
    onGoInvoices(kind);
  };

  return (
    <div className="quick-search" ref={rootRef}>
      <span className="quick-search-icon"><SearchIcon /></span>
      <input
        type="text"
        className="quick-search-input"
        placeholder={t("nav.search.placeholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => { if (query.trim().length >= 2) setOpen(true); }}
      />
      {query && (
        <button type="button" className="quick-search-clear" onClick={() => { setQuery(""); setOpen(false); }} aria-label={t("nav.search.clear")}>✕</button>
      )}

      {open && q.length >= 2 && (
        <div className="quick-search-dropdown" role="menu">
          {loading && !pool ? (
            <p className="quick-search-loading">{t("nav.search.loading")}</p>
          ) : totalResults === 0 ? (
            <p className="quick-search-empty">{t("nav.search.noResults")}</p>
          ) : (
            <>
              {results.customers.length > 0 && (
                <div className="quick-search-group">
                  <div className="quick-search-group-title">{t("nav.search.customers")}</div>
                  {results.customers.map((c) => (
                    <button key={c.id} type="button" className="quick-search-item" disabled={!c.accountId} onClick={() => selectAccount(c.accountId)}>
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
              {results.suppliers.length > 0 && (
                <div className="quick-search-group">
                  <div className="quick-search-group-title">{t("nav.search.suppliers")}</div>
                  {results.suppliers.map((s) => (
                    <button key={s.id} type="button" className="quick-search-item" disabled={!s.accountId} onClick={() => selectAccount(s.accountId)}>
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
              {results.salesInvoices.length > 0 && (
                <div className="quick-search-group">
                  <div className="quick-search-group-title">{t("nav.search.salesInvoices")}</div>
                  {results.salesInvoices.map((i) => (
                    <button key={i.id} type="button" className="quick-search-item" onClick={() => selectInvoices("sales")}>
                      {i.invoiceNumber} {i.customer?.name ? `— ${i.customer.name}` : ""}
                    </button>
                  ))}
                </div>
              )}
              {results.purchaseInvoices.length > 0 && (
                <div className="quick-search-group">
                  <div className="quick-search-group-title">{t("nav.search.purchaseInvoices")}</div>
                  {results.purchaseInvoices.map((i) => (
                    <button key={i.id} type="button" className="quick-search-item" onClick={() => selectInvoices("purchases")}>
                      {i.invoiceNumber} {i.supplier?.name ? `— ${i.supplier.name}` : ""}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
