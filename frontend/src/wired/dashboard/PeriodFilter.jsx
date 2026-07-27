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

  const range = useMemo(() => (preset === "custom" ? { dateFrom: customFrom, dateTo: customTo } : computeRange(preset)), [preset, customFrom, customTo]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onChange(range); }, []);

  const apply = (p, from, to) => {
    const r = p === "custom" ? { dateFrom: from, dateTo: to } : computeRange(p);
    onChange(r);
  };

  return (
    <div className="period-filter">
      {PRESETS.map((p) => (
        <button
          key={p.id}
          className={"report-tab" + (preset === p.id ? " active" : "")}
          onClick={() => { setPreset(p.id); apply(p.id, customFrom, customTo); }}
        >
          {p.label}
        </button>
      ))}
      {preset === "custom" && (
        <>
          <input type="date" value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); apply("custom", e.target.value, customTo); }} />
          <span>إلى</span>
          <input type="date" value={customTo} onChange={(e) => { setCustomTo(e.target.value); apply("custom", customFrom, e.target.value); }} />
        </>
      )}
    </div>
  );
}

export { computeRange };
