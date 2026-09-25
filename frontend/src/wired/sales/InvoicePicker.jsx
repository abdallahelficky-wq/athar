import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listSalesInvoices } from "../../api/salesInvoices";

/**
 * فلتر "الفاتورة الأصلية" لقائمة مردودات المبيعات — نفس بنية CustomerPicker.jsx بالضبط (راجعه
 * لتبرير التصميم العام: قائمة محدودة تُجلَب مرة واحدة وتُفلتَر محلياً)، لكنه يبحث برقم الفاتورة لا
 * اسم عميل، ويقتصر على الفواتير المرحّلة فقط (فاتورة غير مرحّلة لا يمكن ربط إشعار دائن بها أصلاً).
 */
export default function InvoicePicker({ companyId, value, onChange, placeholder }) {
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!companyId) { setInvoices([]); return; }
    listSalesInvoices(companyId).then((invs) => setInvoices(invs.filter((i) => i.status === "posted"))).catch(() => setInvoices([]));
  }, [companyId]);

  useEffect(() => {
    const onDocClick = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const selected = useMemo(() => invoices.find((i) => i.id === value) || null, [invoices, value]);
  const q = query.trim().toLowerCase();
  const matches = q ? invoices.filter((i) => i.invoiceNumber.toLowerCase().includes(q)) : invoices;

  return (
    <div className="customer-picker" ref={rootRef}>
      <input
        type="text"
        value={open ? query : selected?.invoiceNumber || ""}
        placeholder={placeholder || t("sales.returns.search.originalInvoicePlaceholder")}
        onFocus={() => { setQuery(""); setOpen(true); }}
        onChange={(e) => setQuery(e.target.value)}
      />
      {open && (
        <div className="item-combo-dropdown">
          <div className="item-combo-option" onClick={() => { onChange(""); setOpen(false); setQuery(""); }}>
            {t("sales.returns.search.originalInvoiceAll")}
          </div>
          {matches.slice(0, 50).map((i) => (
            <div key={i.id} className="item-combo-option" onClick={() => { onChange(i.id); setOpen(false); setQuery(""); }}>
              {i.invoiceNumber}
            </div>
          ))}
          {matches.length === 0 && <div className="item-combo-option">{t("common.noResults")}</div>}
        </div>
      )}
    </div>
  );
}
