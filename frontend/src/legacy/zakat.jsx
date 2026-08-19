import React from "react";
import { useTranslation } from "react-i18next";
import { STATIONS, aggregateAccounts, fmt } from "./constants";
import { Gauge } from "./shared";

export function ZakatModule({ entries, sales, companyId }) {
  const { t } = useTranslation();
  const acc = aggregateAccounts(entries, companyId);
  const outputVatFromEntries = (acc["المبيعات - وقود"]?.credit || 0) + (acc["المبيعات - زيوت وخدمات"]?.credit || 0);
  const relevantStations = companyId === "all" ? STATIONS : STATIONS.filter((s) => s.company === companyId);
  const stationIds = new Set(relevantStations.map((s) => s.id));
  const stationRevenue = sales.filter((s) => stationIds.has(s.stationId)).reduce((s, r) => s + r.liters * r.pricePerLiter, 0);
  const salesBase = outputVatFromEntries + stationRevenue;
  const outputVat = (acc["ضريبة القيمة المضافة - مخرجات"]?.credit || 0) + stationRevenue * 0.15;
  const inputVat = (acc["ضريبة القيمة المضافة - مدخلات"]?.debit || 0);
  const netVat = outputVat - inputVat;
  const zakatBase = salesBase * 0.15; // نسبة تقديرية توضيحية فقط
  const currency = t("common.currency");

  return (
    <div>
      <div className="section-title">
        <span className="eyebrow">{t("zakat.eyebrow")}</span>
        <h2>{t("zakat.title")}</h2>
      </div>
      <p className="note">{t("zakat.disclaimer")}</p>
      <div className="gauge-row">
        <Gauge label={t("zakat.gauge.salesBase")} value={salesBase} max={800000} unit={currency} tone="#2F5D5A" />
        <Gauge label={t("zakat.gauge.outputVat")} value={outputVat} max={120000} unit={currency} tone="#A8432B" />
        <Gauge label={t("zakat.gauge.inputVat")} value={inputVat} max={30000} unit={currency} tone="#3E6B8A" />
        <Gauge label={t("zakat.gauge.netVat")} value={Math.max(netVat, 0)} max={100000} unit={currency} tone="#B98B4E" />
      </div>
      <div className="panel">
        <h3>{t("zakat.baseTitle")}</h3>
        <table className="ledger-table">
          <tbody>
            <tr><td>{t("zakat.gauge.salesBase")}</td><td className="num">{fmt(salesBase)} {currency}</td></tr>
            <tr><td>{t("zakat.baseRatioLabel")}</td><td className="num">{t("zakat.baseRatioValue")}</td></tr>
            <tr><td className="strong">{t("zakat.baseFinal")}</td><td className="num strong">{fmt(zakatBase)} {currency}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
