import React, { useEffect, useMemo, useState } from "react";

const toISO = (d) => d.toISOString().slice(0, 10);

function computeRange(preset) {
  const now = new Date();
  if (preset === "month") {
    return { dateFrom: toISO(new Date(now.getFullYear(), now.getMonth(), 1)), dateTo: toISO(now) };
  }
  if (preset === "last3") {
    return { dateFrom: toISO(new Date(now.getFullYear(), now.getMonth() - 2, 1)), dateTo: toISO(now) };
  }
  if (preset === "year") {
    return { dateFrom: toISO(new Date(now.getFullYear(), 0, 1)), dateTo: toISO(now) };
  }
  return null; // custom — يُدار عبر حقول التاريخ يدوياً
}

const PRESETS = [
  { id: "month", label: "الشهر الحالي" },
  { id: "last3", label: "آخر ٣ أشهر" },
  { id: "year", label: "هذه السنة" },
  { id: "custom", label: "فترة مخصصة" },
];

/** فلتر فترة زمنية مشترك بين الداشبوردين — يستدعي onChange({dateFrom, dateTo}) بصيغة ISO */
export default function PeriodFilter({ onChange }) {
  const [preset, setPreset] = useState("month");
  const [customFrom, setCustomFrom] = useState(() => toISO(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [customTo, setCustomTo] = useState(() => toISO(new Date()));

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onChange(computeRange(preset) || { dateFrom: customFrom, dateTo: customTo }); }, []);

  const applyPreset = (p) => {
    setPreset(p);
    // الأزرار الجاهزة (شهر/٣ أشهر/سنة) تُطبَّق فوراً بالضغط — هي اختيار واحد صريح وليست كتابة
    // حرة، فلا تعاني من مشكلة "فلترة أثناء الكتابة" التي دفعت لتأجيل حقول التاريخ المخصصة أدناه.
    onChange(p === "custom" ? { dateFrom: customFrom, dateTo: customTo } : computeRange(p));
  };

  return (
    <div className="period-filter">
      {PRESETS.map((p) => (
        <button
          key={p.id}
          className={"subtab" + (preset === p.id ? " active" : "")}
          onClick={() => applyPreset(p.id)}
        >
          {p.label}
        </button>
      ))}
      {preset === "custom" && (
        <form style={{ display: "contents" }} onSubmit={(e) => { e.preventDefault(); onChange({ dateFrom: customFrom, dateTo: customTo }); }}>
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          <span>إلى</span>
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          <button type="submit" className="btn-primary">إظهار النتائج</button>
        </form>
      )}
    </div>
  );
}

export { computeRange };
