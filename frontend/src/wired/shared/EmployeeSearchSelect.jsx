import React, { forwardRef, useState } from "react";

/**
 * قائمة موظفين قابلة للبحث الفوري — نفس بنية AccountSearchSelect (item-combo-cell/dropdown/option)
 * معمَّمة هنا لأي قائمة employees، تُستخدَم لاختيار "عهدة" موظف على أصل ثابت (Phase C) وأي شاشة
 * أخرى مستقبلية تحتاج اختيار موظف من قائمة قد تطول.
 */
const EmployeeSearchSelect = forwardRef(function EmployeeSearchSelect(
  { employees, value, onChange, placeholder, allowClear, clearLabel, autoFocus },
  ref,
) {
  const [searchText, setSearchText] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const label = (e) => (e.jobTitle ? `${e.name} — ${e.jobTitle}` : e.name);
  const norm = (s) => (s || "").toString().toLowerCase();

  const selected = employees.find((e) => e.id === value);
  const query = norm(searchText).trim();
  const filtered = employees.filter((e) => !query || norm(e.name).includes(query) || norm(e.jobTitle).includes(query));
  const options = [...(allowClear ? [{ id: "", __clear: true }] : []), ...filtered];

  const pick = (employeeId) => {
    onChange(employeeId);
    setOpen(false);
    setSearchText("");
  };

  const onKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey) return;
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
    <label className="item-combo-cell employee-search-select">
      <input
        ref={ref}
        type="text"
        autoFocus={autoFocus}
        value={open ? searchText : (selected ? label(selected) : "")}
        onChange={(e) => { setSearchText(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => { setSearchText(""); setOpen(true); setHighlight(0); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        placeholder={placeholder || "ابحث باسم الموظف..."}
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
          {filtered.map((e, i) => {
            const optIndex = allowClear ? i + 1 : i;
            return (
              <div
                key={e.id}
                className={"item-combo-option" + (optIndex === highlight ? " item-combo-option-active" : "")}
                onMouseDown={() => pick(e.id)}
                onMouseEnter={() => setHighlight(optIndex)}
              >
                {label(e)}
              </div>
            );
          })}
          {filtered.length === 0 && <div className="item-combo-option">لا توجد نتائج</div>}
        </div>
      )}
    </label>
  );
});

export default EmployeeSearchSelect;
