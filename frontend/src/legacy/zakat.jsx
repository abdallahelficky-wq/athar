import React from "react";
import { STATIONS, aggregateAccounts, fmt } from "./constants";
import { Gauge } from "./shared";

export function ZakatModule({ entries, sales, companyId }) {
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

  return (
    <div>
      <div className="section-title">
        <span className="eyebrow">الامتثال الضريبي</span>
        <h2>الزكاة وضريبة القيمة المضافة</h2>
      </div>
      <p className="note">
        الأرقام هنا تقديرية لأغراض العرض التجريبي فقط، وتُبنى من نفس بيانات القيود والمبيعات المسجّلة أعلاه —
        وليست بديلاً عن ربط فعلي ببوابة زاتكا.
      </p>
      <div className="gauge-row">
        <Gauge label="إجمالي المبيعات الخاضعة" value={salesBase} max={800000} unit="ر.س" tone="#2F5D5A" />
        <Gauge label="ضريبة المخرجات" value={outputVat} max={120000} unit="ر.س" tone="#A8432B" />
        <Gauge label="ضريبة المدخلات" value={inputVat} max={30000} unit="ر.س" tone="#3E6B8A" />
        <Gauge label="صافي الضريبة المستحقة" value={Math.max(netVat, 0)} max={100000} unit="ر.س" tone="#B98B4E" />
      </div>
      <div className="panel">
        <h3>وعاء الزكاة التقديري</h3>
        <table className="ledger-table">
          <tbody>
            <tr><td>إجمالي المبيعات الخاضعة</td><td className="num">{fmt(salesBase)} ر.س</td></tr>
            <tr><td>نسبة تقديرية للوعاء الزكوي</td><td className="num">15٪ (تجريبية)</td></tr>
            <tr><td className="strong">الوعاء الزكوي التقديري</td><td className="num strong">{fmt(zakatBase)} ر.س</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

