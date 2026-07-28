import React, { useEffect, useState } from "react";
import { getFinancialKpis } from "../api/dashboard";
import { fmt } from "../legacy/constants";
import FinancialDashboard from "./dashboard/FinancialDashboard";
import Breadcrumb from "./shared/Breadcrumb";

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

/** جدول مقارنة سريع بين شركات المجموعة (كل شركة على حدة) يُكمّل الأرقام المجمّعة لكل
 * المجموعة التي تعرضها FinancialDashboard نفسها (بدون تمرير companyId = تجميع تلقائي) */
function GroupComparisonTable({ companies }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    const now = new Date();
    const dateFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const dateTo = now.toISOString().slice(0, 10);
    Promise.all(companies.map((c) => getFinancialKpis(c.id, dateFrom, dateTo).then((k) => ({ company: c, ...k })))).then(setRows);
  }, [companies]);

  if (!rows) return <p className="empty">جارٍ تجميع بيانات كل الشركات...</p>;

  const grand = rows.reduce(
    (acc, r) => ({
      salesCurrent: acc.salesCurrent + r.salesCurrent,
      netProfitEstimate: acc.netProfitEstimate + r.netProfitEstimate,
      cashBalance: acc.cashBalance + r.cashBalance,
      receivablesTotal: acc.receivablesTotal + r.receivablesTotal,
      payablesTotal: acc.payablesTotal + r.payablesTotal,
    }),
    { salesCurrent: 0, netProfitEstimate: 0, cashBalance: 0, receivablesTotal: 0, payablesTotal: 0 },
  );

  return (
    <div className="panel">
      <h3>مقارنة بين شركات المجموعة (الشهر الحالي)</h3>
      <table className="ledger-table">
        <thead><tr><th>الشركة</th><th>صافي المبيعات</th><th>صافي الربح التقديري</th><th>الرصيد النقدي</th><th>مستحقات العملاء</th><th>مستحقات الموردين</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.company.id}>
              <td>{r.company.name}</td>
              <td className="num">{fmt(r.salesCurrent)}</td>
              <td className="num">{fmt(r.netProfitEstimate)}</td>
              <td className="num">{fmt(r.cashBalance)}</td>
              <td className="num">{fmt(r.receivablesTotal)}</td>
              <td className="num">{fmt(r.payablesTotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="foot-label">الإجمالي</td>
            <td className="num strong">{fmt(grand.salesCurrent)}</td>
            <td className="num strong">{fmt(grand.netProfitEstimate)}</td>
            <td className="num strong">{fmt(grand.cashBalance)}</td>
            <td className="num strong">{fmt(grand.receivablesTotal)}</td>
            <td className="num strong">{fmt(grand.payablesTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
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
        <Breadcrumb parts={["نظرة عامة", "بيانات حقيقية"]} />
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
            <>
              <FinancialDashboard companyId={undefined} />
              <GroupComparisonTable companies={companies} />
            </>
          ) : companyId ? (
            <FinancialDashboard companyId={companyId} />
          ) : (
            <p className="empty">اختر شركة من الأعلى لعرض لوحة قيادتها.</p>
          )}
        </>
      )}
    </div>
  );
}
