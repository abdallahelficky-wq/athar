import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { getFinancialKpis } from "../api/dashboard";
import { fmt } from "../legacy/constants";
import FinancialDashboard from "./dashboard/FinancialDashboard";
import DashPeriod from "./dashboard/DashPeriod";
import { DashCard } from "./dashboard/DashParts";
import { computeRange } from "./dashboard/PeriodFilter";
import { useWelcomeText } from "./shared/WelcomeBanner";
import { routes } from "../routes";
import DraftEntriesNotice from "./shared/DraftEntriesNotice";
import "../styles/lease-screen.css";
import "../styles/dashboard-screen.css";

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
    <div className="dash-grid">
      <DashCard span={12} tone="blue" title={t("dashboard.comparisonTitle")}>
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
                <td className="ss-num">{r.company.name}</td>
                <td className="num">{fmt(r.salesCurrent)}</td>
                <td className="num">{fmt(r.netProfitEstimate)}</td>
                <td className="num">{fmt(r.cashBalance)}</td>
                <td className="num">{fmt(r.receivablesTotal)}</td>
                <td className="num">{fmt(r.payablesTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="filtered-summary-row">
              <td className="foot-label">{t("dashboard.comparisonTable.total")}</td>
              <td className="num strong">{fmt(grand.salesCurrent)}</td>
              <td className="num strong">{fmt(grand.netProfitEstimate)}</td>
              <td className="num strong">{fmt(grand.cashBalance)}</td>
              <td className="num strong">{fmt(grand.receivablesTotal)}</td>
              <td className="num strong">{fmt(grand.payablesTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </DashCard>
    </div>
  );
}

const HERO_ICON = (
  <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7.5" height="9" rx="2" /><rect x="13.5" y="3" width="7.5" height="5.5" rx="2" />
    <rect x="13.5" y="11.5" width="7.5" height="9.5" rx="2" /><rect x="3" y="15.5" width="7.5" height="5.5" rx="2" />
  </svg>
);

/**
 * الشاشة الرئيسية — اختيار "الشركة النشطة" نفسها يتم حصراً عبر CompanySwitcher بالقائمة الجانبية؛
 * هذه الصفحة تعرض فقط لوحة قيادة تلك الشركة، مع زر ثانوي صغير لعرض تجميعي ("المجموعة كاملة")
 * لا يُغيّر الشركة النشطة الفعلية (الشاشات الأخرى تحتاج شركة واحدة محدَّدة دائماً).
 * الرأس الملوَّن يحمل التحية والمقولة اليومية وفترة العرض (الفترة تُمرَّر لـ FinancialDashboard).
 */
export default function Dashboard({ companies, companyId }) {
  const { t } = useTranslation();
  const { greeting, quote } = useWelcomeText();
  const [viewMode, setViewMode] = useState("company");
  const [range, setRange] = useState(() => computeRange("month"));

  // اختيار الشركة النشطة أصبح حصراً عبر CompanySwitcher بالقائمة الجانبية — أي تغيير فعلي
  // لـ companyId (اختيار شركة أخرى من هناك) يعيد الداشبورد تلقائياً لعرض "شركة واحدة" حتى لو كان
  // المستخدم قد فتح عرض "المجموعة كاملة" قبل ذلك، بنفس السلوك الذي كانت توفّره بطاقات الشركة سابقاً.
  useEffect(() => {
    setViewMode("company");
  }, [companyId]);

  const scopeName = viewMode === "consolidated"
    ? t("dashboard.screen.groupLabel")
    : companies.find((c) => c.id === companyId)?.name || "";

  return (
    <div className="lease-screen dash-screen">
      <div className="ls-hero">
        <div className="ls-hero-top">
          <div className="ls-hero-main">
            <div className="ls-hero-icon" aria-hidden="true">{HERO_ICON}</div>
            <div>
              <span className="dash-eyebrow">{t("dashboard.screen.eyebrow")}{scopeName ? ` · ${scopeName}` : ""}</span>
              <h3>{greeting}</h3>
              {quote && <p>{quote}</p>}
            </div>
          </div>
          {companies.length > 1 && (
            <div className="ls-hero-actions">
              <button type="button" className="ls-btn ls-btn-glass" onClick={() => setViewMode((v) => (v === "consolidated" ? "company" : "consolidated"))}>
                {viewMode === "consolidated" ? t("dashboard.backToSingleCompany") : t("dashboard.viewConsolidated")}
              </button>
            </div>
          )}
        </div>
        {companies.length > 0 && (
          <div className="ls-chips">
            <DashPeriod onChange={setRange} />
            {range && <span className="ls-chip ls-chip-info">{t("dashboard.screen.rangeInfo", { from: `\u2066${range.dateFrom}\u2069`, to: `\u2066${range.dateTo}\u2069` })}</span>}
          </div>
        )}
      </div>

      {companies.length === 0 ? (
        <div className="panel form-panel">
          <p className="empty">{t("dashboard.noCompanies")}</p>
          <div className="form-btn-group">
            <Link className="btn-primary" to={routes.settings("companies")}>{t("dashboard.addFirstCompany")}</Link>
          </div>
        </div>
      ) : (
        <>
          <DraftEntriesNotice companyId={viewMode === "consolidated" ? undefined : companyId || undefined} />
          {viewMode === "consolidated" ? (
            <>
              <FinancialDashboard companyId={undefined} companies={companies} range={range} />
              <GroupComparisonTable companies={companies} />
            </>
          ) : companyId ? (
            <FinancialDashboard companyId={companyId} companies={companies} range={range} />
          ) : (
            <p className="empty">{t("dashboard.chooseCompanyPrompt")}</p>
          )}
        </>
      )}
    </div>
  );
}
