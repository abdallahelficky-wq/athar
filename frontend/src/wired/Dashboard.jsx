import React, { useEffect, useState } from "react";
import { listJournalEntries } from "../api/journalEntries";
import { getIncomeStatement } from "../api/reports";
import { fmt } from "../legacy/constants";
import { Gauge } from "../legacy/shared";
import CompanySelector from "./CompanySelector";

export default function Dashboard({ companies, companyId, setCompanyId, onCompanyCreated }) {
  const [entries, setEntries] = useState([]);
  const [income, setIncome] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!companyId) { setEntries([]); setIncome(null); return; }
    setLoading(true);
    Promise.all([
      listJournalEntries({ companyId }),
      getIncomeStatement({ companyId }),
    ])
      .then(([e, i]) => { setEntries(e); setIncome(i); })
      .finally(() => setLoading(false));
  }, [companyId]);

  const postedEntries = entries.filter((e) => e.status === "posted");
  const entryTotal = (e) => e.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalDebit = postedEntries.reduce((s, e) => s + entryTotal(e), 0);

  return (
    <div>
      <div className="section-title">
        <span className="eyebrow">نظرة عامة — بيانات حقيقية</span>
        <h2>لوحة القيادة المالية</h2>
      </div>

      <CompanySelector companies={companies} companyId={companyId} setCompanyId={setCompanyId} onCompanyCreated={onCompanyCreated} />

      {!companyId ? (
        <p className="empty">أنشئ شركة أولاً من الأعلى لعرض لوحة القيادة.</p>
      ) : loading ? (
        <p className="empty">جارٍ التحميل...</p>
      ) : (
        <>
          <div className="gauge-row gauge-row-3">
            <Gauge label="حجم الحركة المحاسبية (مرحّل)" value={totalDebit} max={600000} unit="ر.س" tone="#2F5D5A" />
            <Gauge label="عدد القيود المسجّلة" value={entries.length} max={20} unit="قيد" tone="#8A5A3E" />
            <Gauge label="صافي الربح" value={Math.max(income?.netIncome || 0, 0)} max={600000} unit="ر.س" tone="#B98B4E" />
          </div>
          <div className="panel">
            <h3>آخر القيود</h3>
            <ul className="mini-list">
              {entries.slice(0, 6).map((e) => (
                <li key={e.id}>
                  <span className="mini-date">{e.date.slice(0, 10)}</span>
                  <span className="mini-memo">{e.memo || "بدون بيان"} {e.status === "draft" && "(مسودة)"}</span>
                  <span className="mini-amount">{fmt(entryTotal(e))} ر.س</span>
                </li>
              ))}
              {entries.length === 0 && <li className="empty">لا توجد قيود لهذه الشركة بعد</li>}
            </ul>
          </div>
          <p className="note">
            باقي موديولات لوحة القيادة الأصلية (مبيعات المحطات، تنبيهات مستندات الموظفين...) تعتمد على موديولات
            لم تُربط بعد بالـ backend الحقيقي، لذا لا تظهر هنا حالياً — انظر تبويبات المبيعات/المشتريات/الموظفين
            التي ما زالت تعمل ببيانات تجريبية محلية كما كانت.
          </p>
        </>
      )}
    </div>
  );
}
