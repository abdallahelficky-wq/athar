import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listCustomers } from "../../api/customers";

/**
 * قائمة عملاء الشركة عادةً محدودة (عشرات إلى بضع مئات) — تُجلَب مرة واحدة لكل companyId وتُفلتَر
 * محلياً مع كل حرف، بنفس أسلوب QuickSearch.jsx، بدل نقطة نهاية بحث خادم منفصلة لعدد بيانات بهذا
 * الحجم. مُعاد الاستخدام لاحقاً لأي فلتر/حقل "اختر عميلاً" آخر (مردودات، سندات قبض، عروض أسعار).
 */
export default function CustomerPicker({ companyId, value, onChange, placeholder }) {
  const { t } = useTranslation();
  const [customers, setCustomers] = useState([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!companyId) { setCustomers([]); return; }
    listCustomers(companyId).then(setCustomers).catch(() => setCustomers([]));
  }, [companyId]);

  useEffect(() => {
    const onDocClick = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const selected = useMemo(() => customers.find((c) => c.id === value) || null, [customers, value]);
  const q = query.trim().toLowerCase();
  const matches = q ? customers.filter((c) => c.name.toLowerCase().includes(q)) : customers;

  return (
    <div className="customer-picker" ref={rootRef}>
      <input
        type="text"
        value={open ? query : selected?.name || ""}
        placeholder={placeholder || t("filters.customerSearchPlaceholder")}
        onFocus={() => { setQuery(""); setOpen(true); }}
        onChange={(e) => setQuery(e.target.value)}
      />
      {open && (
        <div className="item-combo-dropdown">
          <div
            className="item-combo-option"
            onClick={() => { onChange(""); setOpen(false); setQuery(""); }}
          >
            {t("filters.allCustomers")}
          </div>
          {matches.slice(0, 50).map((c) => (
            <div
              key={c.id}
              className="item-combo-option"
              onClick={() => { onChange(c.id); setOpen(false); setQuery(""); }}
            >
              {c.name}
            </div>
          ))}
          {matches.length === 0 && <div className="item-combo-option">{t("common.noResults")}</div>}
        </div>
      )}
    </div>
  );
}
