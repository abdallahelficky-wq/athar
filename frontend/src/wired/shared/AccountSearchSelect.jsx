import React, { forwardRef, useState } from "react";

/**
 * قائمة حسابات قابلة للبحث الفوري داخل نفس الحقل (Search-as-you-type) — تُستخدَم بدل <select> عادي
 * في كل مكان بالنظام محتاج اختيار حساب من شجرة حسابات قد تكون كبيرة (مئات حسابات المستوى الرابع
 * بعد توسيع الترقيم إلى 6 أرقام). البحث يطابق الاسم بالعربية أو الإنجليزية أو الكود معاً، ويظهر
 * "الكود — الاسم" في كل من الحقل والقائمة حتى يمكن تمييز حسابات متشابهة الاسم فوراً.
 * تعتمد نفس أسلوب الـ combobox المستخدَم مسبقاً لاختيار الصنف في فواتير المبيعات
 * (item-combo-cell/dropdown/option)، معمَّمة هنا لأي قائمة accounts بلا أي منطق خاص بشاشة بعينها —
 * مكوّن واحد مشترك لكل شاشات النظام (القيود، الفواتير، السندات، الأصناف، شجرة الحسابات نفسها).
 *
 * دعم كيبورد كامل (Arrow لتحريك التظليل، Enter لاختيار الحساب المظلَّل، Escape لإغلاق القائمة بلا
 * اختيار) — ضروري لتدفّق إدخال قيد يومية بالكيبورد بالكامل بلا لمس الماوس (شاشة القيود). Ctrl/Cmd+Enter
 * يُستثنى عمداً من "اختيار" حتى يمر بلا تعارض لاختصار "حفظ وترحيل" على مستوى النافذة الأعلى.
 * forwardRef يُمرَّر لحقل الإدخال الداخلي مباشرة، يُستخدَم للـ autoFocus والتنقّل البرمجي بين
 * صفوف جدول السطور.
 */
const AccountSearchSelect = forwardRef(function AccountSearchSelect(
  { accounts, value, onChange, placeholder, allowClear, clearLabel, autoFocus },
  ref,
) {
  const [searchText, setSearchText] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const label = (a) => `${a.code} — ${a.name}`;
  const norm = (s) => (s || "").toString().toLowerCase();

  const selected = accounts.find((a) => a.id === value);
  const query = norm(searchText).trim();
  const filtered = accounts.filter(
    (a) => !query || norm(a.name).includes(query) || norm(a.nameEn).includes(query) || norm(a.code).includes(query),
  );
  // قائمة الاختيارات الفعلية بترتيب الظهور (خيار "بلا" أولاً إن وُجد، ثم الحسابات المطابقة) — تُستخدَم
  // لحساب الحساب المظلَّل بمفاتيح الأسهم والاختيار بـ Enter بنفس الترتيب المرئي بالضبط.
  const options = [...(allowClear ? [{ id: "", __clear: true }] : []), ...filtered];

  const pick = (accountId) => {
    onChange(accountId);
    setOpen(false);
    setSearchText("");
  };

  const onKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey) return; // اترك Ctrl/Cmd+Enter يمر بلا تدخّل لاختصارات النافذة الأعلى
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { setOpen(true); setHighlight(0); return; }
      setHighlight((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); setHighlight(0); return; }
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (open && options.length > 0) {
        e.preventDefault();
        const opt = options[Math.min(highlight, options.length - 1)];
        pick(opt.__clear ? "" : opt.id);
      }
    } else if (e.key === "Escape") {
      if (open) { e.preventDefault(); setOpen(false); setSearchText(""); }
    }
  };

  return (
    <label className="item-combo-cell account-search-select">
      <input
        ref={ref}
        type="text"
        autoFocus={autoFocus}
        value={open ? searchText : (selected ? label(selected) : "")}
        onChange={(e) => { setSearchText(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => { setSearchText(""); setOpen(true); setHighlight(0); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        placeholder={placeholder || "ابحث بالاسم أو الكود..."}
      />
      {open && (
        <div className="item-combo-dropdown">
          {allowClear && (
            <div
              className={"item-combo-option" + (options[highlight]?.__clear ? " item-combo-option-active" : "")}
              onMouseDown={() => pick("")}
              onMouseEnter={() => setHighlight(0)}
            >
              {clearLabel || "— بلا —"}
            </div>
          )}
          {filtered.map((a, i) => {
            const optIndex = allowClear ? i + 1 : i;
            return (
              <div
                key={a.id}
                className={"item-combo-option" + (optIndex === highlight ? " item-combo-option-active" : "")}
                onMouseDown={() => pick(a.id)}
                onMouseEnter={() => setHighlight(optIndex)}
              >
                {label(a)}
              </div>
            );
          })}
          {filtered.length === 0 && <div className="item-combo-option">لا توجد نتائج</div>}
        </div>
      )}
    </label>
  );
});

export default AccountSearchSelect;
