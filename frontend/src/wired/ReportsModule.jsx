import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getTrialBalanceTree, getIncomeStatement, getBalanceSheet } from "../api/reports";
import { listAccounts } from "../api/accounts";
import { listBranches } from "../api/branches";
import { fmt } from "../legacy/constants";
import FinancialStatementPrintModal from "./FinancialStatementPrintModal";
import TrialBalanceTreePrintModal from "./TrialBalanceTreePrintModal";
import { Icon } from "../legacy/shared";
import Breadcrumb from "./shared/Breadcrumb";
import SubTabs from "./shared/SubTabs";
import { useModuleTab } from "./shared/useModuleTab";
import ReportRollupFilter from "./shared/ReportRollupFilter";
import TrialBalanceView from "./TrialBalanceView";
import { collectGroupAccountIds, flattenVisibleTree } from "./shared/trialBalanceTree";
import { exportTrialBalanceExcel } from "./shared/exportTrialBalanceExcel";
import { useDeferredFilters } from "./shared/useDeferredFilters";
import { defaultDateRangeForCompany } from "./shared/fiscalClosing";
import ComprehensiveMonthlyReport from "./ComprehensiveMonthlyReport";
import ReportScheduleAutomation from "./ReportScheduleAutomation";

export const REPORT_TABS = [
  { id: "trial", labelKey: "nav.tabs.trial" },
  { id: "income", labelKey: "nav.tabs.income" },
  { id: "balance", labelKey: "nav.tabs.balance" },
  { id: "monthly", labelKey: "nav.tabs.monthly" },
  { id: "automation", labelKey: "nav.tabs.automation" },
];

/**
 * صفوف شجرة مبلغ واحد (إيراد/مصروف أو أصل/التزام/حقوق) — تُعرَض موسّعة بالكامل دائماً (بلا طي/فتح
 * يدوي كميزان المراجعة)، لأن "المستوى" هنا هو أداة التحكّم الوحيدة في عمق العرض، ونطاق كل قسم
 * أصلاً محدود بنوع الحساب فلا داعي لأداة طي إضافية. تُستخدَم لكل الأقسام الخمسة في الشاشتين.
 */
function AmountTreeRows({ nodes, depth = 0 }) {
  return nodes.map((node) => (
    <React.Fragment key={node.accountId}>
      <tr className={"tb-tree-row" + (!node.isPosting ? " tb-group" : "")}>
        <td style={{ paddingRight: 8 + depth * 22 }}>{node.code} — {node.name}</td>
        <td className="num">{fmt(node.amount)}</td>
      </tr>
      {node.children.length > 0 && <AmountTreeRows nodes={node.children} depth={depth + 1} />}
    </React.Fragment>
  ));
}

function IncomeStatementView({ data, accounts, filters, branches }) {
  const { t } = useTranslation();
  if (!data) return null;
  const { draft, setField, apply } = filters;
  return (
    <div className="panel">
      <h3>{t("nav.tabs.income")}</h3>
      <form className="filter-bar" onSubmit={(e) => { e.preventDefault(); apply(); }}>
        <label>{t("reports.income.fromDate")}<input type="date" value={draft.dateFrom} onChange={(e) => setField("dateFrom", e.target.value)} /></label>
        <label>{t("reports.income.toDate")}<input type="date" value={draft.dateTo} onChange={(e) => setField("dateTo", e.target.value)} /></label>
        <ReportRollupFilter accounts={accounts} values={draft} onChange={setField} branches={branches} />
        <button type="submit" className="btn-primary" style={{ alignSelf: "end" }}>{t("reports.income.showResults")}</button>
      </form>
      <table className="ledger-table">
        <tbody>
          <tr><td className="strong section-row" colSpan={2}>{t("reports.income.revenue")}</td></tr>
          <AmountTreeRows nodes={data.revenueRoots} />
          <tr><td className="strong">{t("reports.income.totalRevenue")}</td><td className="num strong">{fmt(data.totalRevenue)}</td></tr>

          <tr><td className="strong section-row" colSpan={2}>{t("reports.income.expenses")}</td></tr>
          <AmountTreeRows nodes={data.expenseRoots} />
          <tr><td className="strong">{t("reports.income.totalExpenses")}</td><td className="num strong">{fmt(data.totalExpense)}</td></tr>

          <tr className="net-row"><td className="strong">{t("reports.income.netIncome")}</td><td className="num strong">{fmt(data.netIncome)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function BalanceSheetView({ data, accounts, filters, branches }) {
  const { t } = useTranslation();
  if (!data) return null;
  const { draft, setField, apply } = filters;
  return (
    <div className="panel">
      <h3>{t("nav.tabs.balance")}</h3>
      <form className="filter-bar" onSubmit={(e) => { e.preventDefault(); apply(); }}>
        <label>{t("reports.balance.asOfDate")}<input type="date" value={draft.asOfDate} onChange={(e) => setField("asOfDate", e.target.value)} /></label>
        <ReportRollupFilter accounts={accounts} values={draft} onChange={setField} branches={branches} />
        <button type="submit" className="btn-primary" style={{ alignSelf: "end" }}>{t("reports.balance.showResults")}</button>
      </form>
      <table className="ledger-table">
        <tbody>
          <tr><td className="strong section-row" colSpan={2}>{t("reports.balance.assets")}</td></tr>
          <AmountTreeRows nodes={data.assetRoots} />
          <tr><td className="strong">{t("reports.balance.totalAssets")}</td><td className="num strong">{fmt(data.totalAssets)}</td></tr>

          <tr><td className="strong section-row" colSpan={2}>{t("reports.balance.liabilities")}</td></tr>
          <AmountTreeRows nodes={data.liabilityRoots} />
          <tr><td className="strong">{t("reports.balance.totalLiabilities")}</td><td className="num strong">{fmt(data.totalLiabilities)}</td></tr>

          <tr><td className="strong section-row" colSpan={2}>{t("reports.balance.equity")}</td></tr>
          <AmountTreeRows nodes={data.equityRoots} />
          <tr><td className="indent">{t("reports.balance.retainedEarnings")}</td><td className="num">{fmt(data.netIncome)}</td></tr>
          <tr><td className="strong">{t("reports.balance.totalEquity")}</td><td className="num strong">{fmt(data.totalEquity)}</td></tr>

          <tr className="net-row">
            <td className="strong">{t("reports.balance.totalLiabEquity")}</td>
            <td className={"num strong " + (data.balanced ? "balance-ok" : "balance-bad")}>
              {fmt(data.totalLiabilities + data.totalEquity)} {data.balanced ? "✓" : "⚠"}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function ReportsModule({ companies, companyId }) {
  const { t } = useTranslation();
  const [tab] = useModuleTab("/reports", REPORT_TABS);
  const [accounts, setAccounts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [incomeStatement, setIncomeStatement] = useState(null);
  const [balanceSheet, setBalanceSheet] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [printing, setPrinting] = useState(false);

  // فلتر التجميع (مستوى/فرع معيّن/تفاصيل/بحث/تواريخ) — لقائمة الدخل والمركز المالي، تعرضان شجرة
  // هرمية لكل قسم (إيرادات/مصروفات أو أصول/التزامات/حقوق) مقصوصة عند المستوى المختار، بنفس منطق
  // truncateTreeDepth المستخدم في ميزان المراجعة. ميزان المراجعة له حالته الهرمية الخاصة أدناه.
  // "مؤجَّلة" (useDeferredFilters): القيم لا تُطبَّق فعلياً (لا يُعاد الجلب) إلا عند الضغط على
  // "إظهار النتائج" أو Enter — راجع تعليق الـ hook نفسه لتفاصيل السبب.
  const rollupFilters = useDeferredFilters({
    dateFrom: "", dateTo: "", asOfDate: new Date().toISOString().slice(0, 10),
    level: 4, accountId: "", includeDetails: false, search: "", branchId: "",
  });

  // حالة ميزان المراجعة الهرمي (Tree View) — مستقلة تماماً عن فلاتر التقريرين الآخرين، ومؤجَّلة
  // بنفس الطريقة.
  const [tbData, setTbData] = useState(null);
  const tb = useDeferredFilters({ dateFrom: "", dateTo: "", level: 4, hideZeroActivity: true, search: "", branchId: "" });
  const [tbExpandedIds, setTbExpandedIds] = useState(new Set());

  // الفترة الافتراضية (من اليوم التالي لتاريخ إقفال الشركة النشطة حتى اليوم) تُطبَّق مرة واحدة فقط
  // بمجرد توفّر بيانات الشركة فعلياً (قد تُحمَّل بعد companyId بلحظات عند أول فتح للتطبيق) — لا تُعاد
  // لاحقاً حتى لا تمحو فلتر اختاره المستخدم يدوياً بعدها.
  const [tbDefaultApplied, setTbDefaultApplied] = useState(false);
  const activeCompany = companies?.find((c) => c.id === companyId);
  useEffect(() => {
    if (tbDefaultApplied || !activeCompany) return;
    tb.reset(defaultDateRangeForCompany(activeCompany, { dateFrom: "", dateTo: "", level: 4, hideZeroActivity: true, search: "", branchId: "" }));
    setTbDefaultApplied(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompany, tbDefaultApplied]);

  useEffect(() => {
    if (!companyId) return;
    listAccounts({ tree: true, companyId }).then(setAccounts).catch(() => {});
    listBranches(companyId).then(setBranches).catch(() => {});
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    const f = tb.applied;
    getTrialBalanceTree({
      companyId,
      from: f.dateFrom || undefined,
      to: f.dateTo || undefined,
      level: f.level,
      hideZeroActivity: f.hideZeroActivity || undefined,
      search: f.search || undefined,
      branchId: f.branchId || undefined,
    })
      .then((tree) => {
        setTbData(tree);
        // الشجرة تُفتح بالكامل افتراضياً عند كل تحميل جديد (تاريخ/فلتر مختلف قد يُظهر حسابات
        // جديدة لم تكن موسَّعة سابقاً)، فلا داعي لتذكّر حالة طي قديمة قد تُخفي نتائج جديدة.
        setTbExpandedIds(collectGroupAccountIds(tree.roots));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, tb.applied]);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    const f = rollupFilters.applied;
    const rollup = { level: f.level, accountId: f.accountId || undefined, includeDetails: f.includeDetails || undefined, search: f.search || undefined, branchId: f.branchId || undefined };
    Promise.all([
      getIncomeStatement({ companyId, from: f.dateFrom || undefined, to: f.dateTo || undefined, ...rollup }),
      getBalanceSheet({ companyId, date: f.asOfDate || undefined, ...rollup }),
    ])
      .then(([is, bs]) => {
        setIncomeStatement(is);
        setBalanceSheet(bs);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, rollupFilters.applied]);

  const tbVisibleRows = tbData ? flattenVisibleTree(tbData.roots, tbExpandedIds) : [];

  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={[t("reports.breadcrumb"), t("dashboard.breadcrumb.realData")]} />
        <h2>{t("reports.title")}</h2>
      </div>

      {error && <p className="balance-bad">{error}</p>}
      {!companyId && tab !== "monthly" && tab !== "automation" ? (
        <p className="empty">{t("reports.noCompany")}</p>
      ) : loading ? (
        <p className="empty">{t("common.loading")}</p>
      ) : (
        <>
          <SubTabs
            tabs={REPORT_TABS}
            active={tab}
            basePath="/reports"
            trailing={<button className="icon-btn" title={t("reports.printCurrent")} onClick={() => setPrinting(true)}><Icon.Printer /></button>}
          />
          {tab === "monthly" && <ComprehensiveMonthlyReport companyId={companyId} companies={companies} />}
          {tab === "automation" && <ReportScheduleAutomation companyId={companyId} />}
          {tab === "trial" && (
            <TrialBalanceView
              data={tbData}
              filters={tb}
              branches={branches}
              expandedIds={tbExpandedIds} setExpandedIds={setTbExpandedIds}
              onPrint={() => setPrinting(true)}
              onExportExcel={() => exportTrialBalanceExcel({
                visibleRows: tbVisibleRows,
                totals: tbData.totals,
                balanced: tbData.balanced,
                company: activeCompany,
                dateFrom: tb.applied.dateFrom,
                dateTo: tb.applied.dateTo,
              })}
            />
          )}
          {tab === "income" && (
            <IncomeStatementView data={incomeStatement} accounts={accounts} filters={rollupFilters} branches={branches} />
          )}
          {tab === "balance" && (
            <BalanceSheetView data={balanceSheet} accounts={accounts} filters={rollupFilters} branches={branches} />
          )}
        </>
      )}

      {printing && tab === "trial" && tbData && (
        <TrialBalanceTreePrintModal
          visibleRows={tbVisibleRows}
          totals={tbData.totals}
          balanced={tbData.balanced}
          dateFrom={tb.applied.dateFrom}
          dateTo={tb.applied.dateTo}
          company={activeCompany}
          onClose={() => setPrinting(false)}
        />
      )}
      {printing && tab !== "trial" && (
        <FinancialStatementPrintModal
          kind={tab}
          data={tab === "income" ? incomeStatement : balanceSheet}
          company={activeCompany}
          asOfDate={tab === "balance" ? rollupFilters.applied.asOfDate : rollupFilters.applied.dateTo}
          autoPrint={false}
          onClose={() => setPrinting(false)}
        />
      )}
    </div>
  );
}
