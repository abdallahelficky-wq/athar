import React, { useEffect, useRef, useState } from "react";
import "../../styles/date-field.css";

// حقل التاريخ الأصلي type="date" يعرض الصيغة حسب لغة المتصفح (mm/dd/yyyy عند الإنجليزية الأمريكية) ولا يمكن
// تغييرها من الصفحة. هذا الحقل يعرض ويقبل dd/mm/yyyy دائماً، ويحتفظ بالقيمة الداخلية YYYY-MM-DD كما كانت،
// مع زرّ تقويم يفتح منتقي المتصفح الأصلي. onChange يستلم نصّ YYYY-MM-DD مباشرة (لا حدثاً).
const toDisplay = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const parseDisplay = (raw) => {
  const s = String(raw).replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).trim();
  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

export default function DateField({ value, onChange, disabled, className = "", ariaLabel }) {
  const [draft, setDraft] = useState(toDisplay(value));
  const [invalid, setInvalid] = useState(false);
  const nativeRef = useRef(null);

  useEffect(() => { setDraft(toDisplay(value)); setInvalid(false); }, [value]);

  const onType = (e) => {
    const text = e.target.value;
    setDraft(text);
    const iso = parseDisplay(text);
    setInvalid(!!text && !iso && /^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}$/.test(text.trim()));
    if (iso) onChange(iso);
  };

  const openPicker = () => {
    const el = nativeRef.current;
    if (!el || disabled) return;
    try { el.showPicker(); } catch { el.focus(); el.click(); }
  };

  return (
    <div className={`date-field ${className}`}>
      <input
        type="text" inputMode="numeric" dir="ltr" autoComplete="off" placeholder="dd/mm/yyyy" maxLength={10}
        value={draft} onChange={onType} disabled={disabled} aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        onBlur={() => { setDraft(toDisplay(value)); setInvalid(false); }}
      />
      <button type="button" className="date-field-btn" onClick={openPicker} disabled={disabled} tabIndex={-1} aria-label="📅">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16.5" rx="3" /><path d="M8 2.5v4M16 2.5v4M3 10h18" /></svg>
      </button>
      <input ref={nativeRef} type="date" className="date-field-native" tabIndex={-1} aria-hidden="true"
        value={value || ""} onChange={(e) => e.target.value && onChange(e.target.value)} />
    </div>
  );
}
