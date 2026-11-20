import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { SalesChip } from "../sales/SalesScreen";
import { computeRange } from "./PeriodFilter";

const PRESETS = [
  { id: "month", key: "reports.periodFilter.presetMonth" },
  { id: "last3", key: "reports.periodFilter.presetLast3" },
  { id: "year", key: "reports.periodFilter.presetYear" },
  { id: "custom", key: "reports.periodFilter.presetCustom" },
];

const toISO = (d) => d.toISOString().slice(0, 10);

/** شرائح الفترة داخل رأس لوحة القيادة — نفس منطق PeriodFilter (الشرائح الجاهزة تُطبَّق فوراً، والمخصَّصة بزر «عرض») */
export default function DashPeriod({ onChange }) {
  const { t } = useTranslation();
  const [preset, setPreset] = useState("month");
  const [from, setFrom] = useState(() => toISO(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [to, setTo] = useState(() => toISO(new Date()));

  const pick = (id) => {
    setPreset(id);
    onChange(id === "custom" ? { dateFrom: from, dateTo: to } : computeRange(id));
  };

  return (
    <>
      {PRESETS.map((p) => (
        <SalesChip key={p.id} on={preset === p.id} onClick={() => pick(p.id)}>{t(p.key)}</SalesChip>
      ))}
      {preset === "custom" && (
        <form className="dash-custom-range" onSubmit={(e) => { e.preventDefault(); onChange({ dateFrom: from, dateTo: to }); }}>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t("reports.periodFilter.presetCustom")} />
          <span>{t("reports.periodFilter.to")}</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t("reports.periodFilter.to")} />
          <button type="submit" className="ls-btn ls-btn-accent">{t("reports.periodFilter.showResults")}</button>
        </form>
      )}
    </>
  );
}
