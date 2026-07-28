import React, { useState } from "react";

/**
 * قائمة حسابات قابلة للبحث الفوري (Search-as-you-type) — تُستخدَم بدل <select> عادي في أي مكان
 * محتاج اختيار حساب من شجرة حسابات قد تكون كبيرة (خصوصاً فلتر البحث بالحساب في شاشة القيود).
 * تعتمد نفس أسلوب الـ combobox المستخدَم مسبقاً لاختيار العميل في فواتير المبيعات
 * (item-combo-cell/dropdown/option)، لكن معمَّمة لأي قائمة accounts بلا أي منطق خاص بالمبيعات.
 */
export default function AccountSearchSelect({ accounts, value, onChange, placeholder, allowClear }) {
  const [searchText, setSearchText] = useState("");
  const [open, setOpen] = useState(false);

  const selected = accounts.find((a) => a.id === value);
  const filtered = accounts.filter((a) => !searchText || a.name.includes(searchText));

  const pick = (accountId) => {
    onChange(accountId);
    setOpen(false);
    setSearchText("");
  };

  return (
    <label className="item-combo-cell account-search-select">
      <input
        type="text"
        value={open ? searchText : (selected?.name || "")}
        onChange={(e) => { setSearchText(e.target.value); setOpen(true); }}
        onFocus={() => { setSearchText(""); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder || "ابحث عن حساب..."}
      />
      {open && (
        <div className="item-combo-dropdown">
          {allowClear && (
            <div className="item-combo-option" onMouseDown={() => pick("")}>— كل الحسابات —</div>
          )}
          {filtered.map((a) => (
            <div key={a.id} className="item-combo-option" onMouseDown={() => pick(a.id)}>{a.name}</div>
          ))}
          {filtered.length === 0 && <div className="item-combo-option">لا توجد نتائج</div>}
        </div>
      )}
    </label>
  );
}
