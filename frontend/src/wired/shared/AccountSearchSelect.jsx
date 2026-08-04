import React, { useState } from "react";

/**
 * قائمة حسابات قابلة للبحث الفوري داخل نفس الحقل (Search-as-you-type) — تُستخدَم بدل <select> عادي
 * في كل مكان بالنظام محتاج اختيار حساب من شجرة حسابات قد تكون كبيرة (مئات حسابات المستوى الرابع
 * بعد توسيع الترقيم إلى 6 أرقام). البحث يطابق الاسم بالعربية أو الإنجليزية أو الكود معاً، ويظهر
 * "الكود — الاسم" في كل من الحقل والقائمة حتى يمكن تمييز حسابات متشابهة الاسم فوراً.
 * تعتمد نفس أسلوب الـ combobox المستخدَم مسبقاً لاختيار الصنف في فواتير المبيعات
 * (item-combo-cell/dropdown/option)، معمَّمة هنا لأي قائمة accounts بلا أي منطق خاص بشاشة بعينها —
 * مكوّن واحد مشترك لكل شاشات النظام (القيود، الفواتير، السندات، الأصناف، شجرة الحسابات نفسها).
 */
export default function AccountSearchSelect({ accounts, value, onChange, placeholder, allowClear, clearLabel }) {
  const [searchText, setSearchText] = useState("");
  const [open, setOpen] = useState(false);

  const label = (a) => `${a.code} — ${a.name}`;
  const norm = (s) => (s || "").toString().toLowerCase();

  const selected = accounts.find((a) => a.id === value);
  const query = norm(searchText).trim();
  const filtered = accounts.filter(
    (a) => !query || norm(a.name).includes(query) || norm(a.nameEn).includes(query) || norm(a.code).includes(query),
  );

  const pick = (accountId) => {
    onChange(accountId);
    setOpen(false);
    setSearchText("");
  };

  return (
    <label className="item-combo-cell account-search-select">
      <input
        type="text"
        value={open ? searchText : (selected ? label(selected) : "")}
        onChange={(e) => { setSearchText(e.target.value); setOpen(true); }}
        onFocus={() => { setSearchText(""); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder || "ابحث بالاسم أو الكود..."}
      />
      {open && (
        <div className="item-combo-dropdown">
          {allowClear && (
            <div className="item-combo-option" onMouseDown={() => pick("")}>{clearLabel || "— بلا —"}</div>
          )}
          {filtered.map((a) => (
            <div key={a.id} className="item-combo-option" onMouseDown={() => pick(a.id)}>{label(a)}</div>
          ))}
          {filtered.length === 0 && <div className="item-combo-option">لا توجد نتائج</div>}
        </div>
      )}
    </label>
  );
}
