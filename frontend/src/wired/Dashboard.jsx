import React, { useEffect, useState } from "react";
import { listJournalEntries } from "../api/journalEntries";
import { getIncomeStatement } from "../api/reports";
import { fmt } from "../legacy/constants";
import { Gauge } from "../legacy/shared";

const AVATAR_COLORS = ["#2F5D5A", "#8A5A3E", "#B98B4E", "#445565", "#A8432B", "#10202E"];
function colorFor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function CompanyIcon({ company, active, onClick }) {
  return (
    <button className={"company-icon-card" + (active ? " active" : "")} onClick={onClick} title={company.name}>
      {company.logoUrl ? (
        <img src={company.logoUrl} alt={company.name} className="company-icon-logo" />
      ) : (
        <div className="company-icon-avatar" style={{ background: colorFor(company.id) }}>
          {company.name.trim().slice(0, 1)}
        </div>
      )}
      <span className="company-icon-name">{company.shortName || company.name}</span>
    </button>
  );
}

function ConsolidatedIcon({ active, onClick }) {
  return (
    <button className={"company-icon-card company-icon-consolidated" + (active ? " active" : "")} onClick={onClick}>
      <div className="company-icon-avatar company-icon-avatar-consolidated">﹢</div>
      <span className="company-icon-name">المجموعة كاملة</span>
    </button>
  );
}

function entryTotal(e) {
  return e.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
}

function SingleCompanyStats({ companyId }) {
  const [entries, setEntries] = useState([]);
  const [income, setIncome] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([listJournalEntries({ companyId }), getIncomeStatement({ companyId })])
      .then(([e, i]) => { setEntries(e); setIncome(i); })
      .finally(() => setLoading(false));
  }, [companyId]);

  if (loading) return <p className="empty">جارٍ التحميل...</p>;

  const postedEntries = entries.filter((e) => e.status === "posted");
  const totalDebit = postedEntries.reduce((s, e) => s + entryTotal(e), 0);

  return (
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
  );
}

/** لوحة قيادة موحّدة للمجموعة كاملة — نفس مؤشرات الشركة الواحدة لكن مجمّعة عبر كل الشركات
 * (باستدعاء تقارير كل شركة على حدة ثم جمعها هنا، بدل نقطة نهاية تجميع جديدة في الخادم) */
function ConsolidatedStats({ companies }) {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all(
      companies.map((c) =>
        Promise.all([listJournalEntries({ companyId: c.id }), getIncomeStatement({ companyId: c.id })]).then(
          ([entries, income]) => {
            const posted = entries.filter((e) => e.status === "posted");
            const totalDebit = posted.reduce((s, e) => s + entryTotal(e), 0);
            return { company: c, entryCount: entries.length, totalDebit, netIncome: income.netIncome };
          },
        ),
      ),
    )
      .then(setRows)
      .finally(() => setLoading(false));
  }, [companies]);

  if (loading || !rows) return <p className="empty">جارٍ تجميع بيانات كل الشركات...</p>;

  const grandDebit = rows.reduce((s, r) => s + r.totalDebit, 0);
  const grandEntries = rows.reduce((s, r) => s + r.entryCount, 0);
  const grandNet = rows.reduce((s, r) => s + r.netIncome, 0);

  return (
    <>
      <div className="gauge-row gauge-row-3">
        <Gauge label="حجم الحركة المحاسبية (كل الشركات)" value={grandDebit} max={2000000} unit="ر.س" tone="#2F5D5A" />
        <Gauge label="عدد القيود (كل الشركات)" value={grandEntries} max={60} unit="قيد" tone="#8A5A3E" />
        <Gauge label="صافي الربح الإجمالي" value={Math.max(grandNet, 0)} max={2000000} unit="ر.س" tone="#B98B4E" />
      </div>
      <div className="panel">
        <h3>مقارنة بين شركات المجموعة</h3>
        <table className="ledger-table">
          <thead><tr><th>الشركة</th><th>عدد القيود</th><th>حجم الحركة المرحّلة</th><th>صافي الربح</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.company.id}>
                <td>{r.company.name}</td>
                <td className="num">{r.entryCount}</td>
                <td className="num">{fmt(r.totalDebit)}</td>
                <td className="num">{fmt(r.netIncome)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="foot-label">الإجمالي</td>
              <td className="num strong">{grandEntries}</td>
              <td className="num strong">{fmt(grandDebit)}</td>
              <td className="num strong">{fmt(grandNet)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

/**
 * الشاشة الرئيسية — نقطة الدخول الوحيدة لاختيار "الشركة النشطة" في كل النظام، عبر أيقونة
 * منفصلة لكل شركة + أيقونة "المجموعة كاملة" لعرض تجميعي لا يُغيّر الشركة النشطة الفعلية
 * (الشاشات الأخرى تحتاج شركة واحدة محدَّدة دائماً). إنشاء شركة جديدة لم يعد يحدث هنا إطلاقاً —
 * فقط من "الإعدادات ← بيانات الشركات".
 */
export default function Dashboard({ companies, companyId, setCompanyId, onNavigateToCompanySettings }) {
  const [viewMode, setViewMode] = useState("company");

  return (
    <div>
      <div className="section-title">
        <span className="eyebrow">نظرة عامة — بيانات حقيقية</span>
        <h2>لوحة القيادة المالية</h2>
      </div>

      {companies.length === 0 ? (
        <div className="panel form-panel">
          <p className="empty">لا توجد شركات بعد.</p>
          <div className="form-btn-group">
            <button className="btn-primary" onClick={onNavigateToCompanySettings}>+ إضافة أول شركة من الإعدادات</button>
          </div>
        </div>
      ) : (
        <>
          <div className="company-icon-row">
            {companies.map((c) => (
              <CompanyIcon
                key={c.id}
                company={c}
                active={viewMode === "company" && companyId === c.id}
                onClick={() => { setCompanyId(c.id); setViewMode("company"); }}
              />
            ))}
            <ConsolidatedIcon active={viewMode === "consolidated"} onClick={() => setViewMode("consolidated")} />
          </div>

          {viewMode === "consolidated" ? (
            <ConsolidatedStats companies={companies} />
          ) : companyId ? (
            <SingleCompanyStats companyId={companyId} />
          ) : (
            <p className="empty">اختر شركة من الأعلى لعرض لوحة قيادتها.</p>
          )}
        </>
      )}
    </div>
  );
}
