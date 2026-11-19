import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * قائمة منسدلة باختيار متعدد (مربعات اختيار) — لفلاتر تقرير الإيجارات. options: [{ value, label, count?, color? }].
 * بلا اختيار = «الكل». searchable يضيف خانة بحث (للمدن). footer عنصر اختياري أسفل القائمة (مثل «استبعاد المحدد»).
 */
export default function LeaseMultiSelect({ label, allLabel, options, value, onChange, searchable, searchPlaceholder, footer, summaryPrefix = "" }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  const shown = useMemo(() => {
    const n = q.trim();
    return n ? options.filter((o) => o.label.includes(n)) : options;
  }, [options, q]);
  const toggle = (v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const labelOf = (v) => options.find((o) => o.value === v)?.label ?? v;
  const summary = !value.length ? allLabel : value.length <= 2 ? value.map(labelOf).join("، ") : `${labelOf(value[0])} +${value.length - 1}`;

  return (
    <div className="ls-ms" ref={ref}>
      <span className="ls-ff-label">{label}</span>
      <button type="button" className={`ls-ms-btn${value.length ? " has-value" : ""}${open ? " is-open" : ""}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="ls-ms-summary">{value.length ? summaryPrefix : ""}{summary}</span>
        {value.length > 0 && <span className="ls-ms-count">{value.length}</span>}
        <span className="ls-ms-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="ls-ms-pop" role="listbox" aria-multiselectable="true">
          {searchable && <input className="ls-ms-search" autoFocus value={q} placeholder={searchPlaceholder} onChange={(e) => setQ(e.target.value)} />}
          <div className="ls-ms-head">
            <button type="button" onClick={() => onChange([])}>{allLabel}</button>
          </div>
          <div className="ls-ms-list">
            {shown.map((o) => (
              <label key={o.value} className={`ls-ms-opt${value.includes(o.value) ? " is-on" : ""}${o.count === 0 ? " is-empty" : ""}`}>
                <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
                {o.color && <span className="ls-ms-dot" style={{ background: o.color }} />}
                <span className="ls-ms-text">{o.label}</span>
                {o.count != null && <span className="ls-ms-n">{o.count}</span>}
              </label>
            ))}
            {shown.length === 0 && <div className="ls-ms-none">—</div>}
          </div>
          {footer && <div className="ls-ms-foot">{footer}</div>}
        </div>
      )}
    </div>
  );
}
