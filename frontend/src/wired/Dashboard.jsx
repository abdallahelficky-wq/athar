import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getFinancialKpis } from "../api/dashboard";
import { fmt } from "../legacy/constants";
import FinancialDashboard from "./dashboard/FinancialDashboard";
import Breadcrumb from "./shared/Breadcrumb";

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
 * الشاشة الرئيسية — اختيار "الشركة النشطة" نفسها يتم حصراً عبر CompanySwitcher بالقائمة الجانبية؛
 * هذه الصفحة تعرض فقط لوحة قيادة تلك الشركة، مع زر ثانوي صغير لعرض تجميعي ("المجموعة كاملة")
 * لا يُغيّر الشركة النشطة الفعلية (الشاشات الأخرى تحتاج شركة واحدة محدَّدة دائماً).
 */
export default function Dashboard({ companies, companyId, onNavigateToCompanySettings }) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState("company");

  // اختيار الشركة النشطة أصبح حصراً عبر CompanySwitcher بالقائمة الجانبية — أي تغيير فعلي
  // لـ companyId (اختيار شركة أخرى من هناك) يعيد الداشبورد تلقائياً لعرض "شركة واحدة" حتى لو كان
  // المستخدم قد فتح عرض "المجموعة كاملة" قبل ذلك، بنفس السلوك الذي كانت توفّره بطاقات الشركة سابقاً.
  useEffect(() => {
    setViewMode("company");
  }, [companyId]);

  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={[t("dashboard.breadcrumb.overview"), t("dashboard.breadcrumb.realData")]} />
        <div className="dashboard-title-row">
          <h2>{t("dashboard.title")}</h2>
          {companies.length > 1 && (
            <button type="button" className="dashboard-consolidated-toggle" onClick={() => setViewMode((v) => (v === "consolidated" ? "company" : "consolidated"))}>
              {viewMode === "consolidated" ? t("dashboard.backToSingleCompany") : t("dashboard.viewConsolidated")}
            </button>
          )}
        </div>
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
