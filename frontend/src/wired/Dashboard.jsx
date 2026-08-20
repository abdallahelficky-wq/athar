import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getFinancialKpis } from "../api/dashboard";
import { fmt } from "../legacy/constants";
import FinancialDashboard from "./dashboard/FinancialDashboard";
import Breadcrumb from "./shared/Breadcrumb";
import CompanyCards from "./shared/CompanyCards";

/** جدول مقارنة سريع بين شركات المجموعة (كل شركة على حدة) يُكمّل الأرقام المجمّعة لكل
 * المجموعة التي تعرضها FinancialDashboard نفسها (بدون تمرير companyId = تجميع تلقائي) */
function GroupComparisonTable({ companies }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    const now = new Date();
    const dateFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const dateTo = now.toISOString().slice(0, 10);
    Promise.all(companies.map((c) => getFinancialKpis(c.id, dateFrom, dateTo).then((k) => ({ company: c, ...k })))).then(setRows);
  }, [companies]);

  if (!rows) return <p className="empty">{t("dashboard.loadingAllCompanies")}</p>;

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
      <h3>{t("dashboard.comparisonTitle")}</h3>
      <table className="ledger-table">
        <thead>
          <tr>
            <th>{t("dashboard.comparisonTable.company")}</th>
            <th>{t("dashboard.comparisonTable.netSales")}</th>
            <th>{t("dashboard.comparisonTable.netProfitEstimate")}</th>
            <th>{t("dashboard.comparisonTable.cashBalance")}</th>
            <th>{t("dashboard.comparisonTable.receivables")}</th>
            <th>{t("dashboard.comparisonTable.payables")}</th>
          </tr>
        </thead>
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
            <td className="foot-label">{t("dashboard.comparisonTable.total")}</td>
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
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState("company");

  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={[t("dashboard.breadcrumb.overview"), t("dashboard.breadcrumb.realData")]} />
        <h2>{t("dashboard.title")}</h2>
      </div>

      {companies.length === 0 ? (
        <div className="panel form-panel">
          <p className="empty">{t("dashboard.noCompanies")}</p>
          <div className="form-btn-group">
            <button className="btn-primary" onClick={onNavigateToCompanySettings}>{t("dashboard.addFirstCompany")}</button>
          </div>
        </div>
      ) : (
        <>
          <CompanyCards
            companies={companies}
            activeCompanyId={companyId}
            consolidatedActive={viewMode === "consolidated"}
            onSelectCompany={(id) => { setCompanyId(id); setViewMode("company"); }}
            onSelectConsolidated={() => setViewMode("consolidated")}
          />

          {viewMode === "consolidated" ? (
            <>
              <FinancialDashboard companyId={undefined} companies={companies} />
              <GroupComparisonTable companies={companies} />
            </>
          ) : companyId ? (
            <FinancialDashboard companyId={companyId} companies={companies} />
          ) : (
            <p className="empty">{t("dashboard.chooseCompanyPrompt")}</p>
          )}
        </>
      )}
    </div>
  );
}
