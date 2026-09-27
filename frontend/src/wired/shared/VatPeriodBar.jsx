import React from "react";
import { useTranslation } from "react-i18next";

/** عنوان الفترة المعروضة + حقلا "من/إلى" — كل أرقام شاشات الضريبة تخص هذه الفترة وحدها. */
export default function VatPeriodBar({ title, period }) {
  const { t } = useTranslation();
  const { draft, applied, frequency, setField, apply } = period;
  return (
    <>
      <h3 data-testid="vat-period-title">
        {title} — {t("vat.period.title", { from: applied.from, to: applied.to })}
        <span className="vat-note"> ({t(`vat.period.frequency.${frequency}`)})</span>
      </h3>
      <form className="filter-bar" onSubmit={(e) => { e.preventDefault(); apply(); }}>
        <label>{t("vat.period.from")}<input type="date" required value={draft.from} onChange={(e) => setField("from", e.target.value)} /></label>
        <label>{t("vat.period.to")}<input type="date" required value={draft.to} onChange={(e) => setField("to", e.target.value)} /></label>
        <button type="submit" className="btn-primary" style={{ alignSelf: "end" }}>{t("vat.period.show")}</button>
      </form>
    </>
  );
}
